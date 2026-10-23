import XCTest

/// Actual coordinated UI flows with explicit state and private-input preconditions.
final class CyclePairCoordinatedUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.seorilabs.cyclepair")
    private var runID = ""
    private var syntheticNote: String { "\(runID)-note" }
    private var syntheticEvent: String { "\(runID)-event" }
    private static let publicCanary = "cyclepair-canary-20261023"
    private static let publicAccountEmail = "cyclepair-public-canary@example.invalid"
    private static let publicAccountPassword = "CyclePair-Public-Canary!2026"

    override func setUpWithError() throws {
        continueAfterFailure = false
        #if targetEnvironment(simulator)
        throw PreparationError.simulatorForbidden
        #endif
        let environment = ProcessInfo.processInfo.environment
        guard environment["CYCLEPAIR_PHYSICAL_UI_APPROVED"] == "1",
              environment["CYCLEPAIR_SYNTHETIC_INSTALLATION"] == "1" else {
            throw PreparationError.approvalOrIsolationMissing
        }
        runID = environment["CYCLEPAIR_TEST_RUN_ID"] ?? ""
        guard runID.range(of: "^cp-[0-9]{17}-[a-f0-9]{6}$", options: .regularExpression) != nil else {
            throw PreparationError.syntheticRunIDMissing
        }
        let flows = [
            "testStartFromOnboarding": "start",
            "testInvitationInputCanary": "invitation-canary",
            "testAccountInputCanary": "account-input-canary",
            "testAccountUpgrade": "account-upgrade",
            "testAccountLogout": "account-logout",
            "testAccountLogin": "account-login",
            "testAccountReauthenticate": "account-reauthenticate",
            "testInvitationAccept": "invitation-accept",
            "testSharingPrivate": "sharing-private",
            "testPartnerReceived": "partner-received",
            "testEventReceived": "event-received",
            "testPartnerRevoked": "partner-revoked",
            "testDisconnectedRestart": "disconnected-restart",
        ]
        guard let flow = flows.first(where: { name.contains($0.key) })?.value,
              environment["CYCLEPAIR_TEST_FLOW"] == flow else {
            throw PreparationError.unsupportedFlow
        }
        guard environment["CYCLEPAIR_CAPTURE_SAFE_SCREENS"] == "0" else {
            throw PreparationError.attachmentsMustBeDisabled
        }
        if flow == "invitation-accept" {
            guard environment["CYCLEPAIR_SECRET_INPUT_VALIDATED"] == "1" else {
                throw PreparationError.secretInputNotValidated
            }
        } else {
            guard (environment["CYCLEPAIR_TEST_INVITATION"] ?? "").isEmpty else {
                throw PreparationError.actualInvitationNotAllowed
            }
        }
        if flow == "account-input-canary" {
            guard environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] == Self.publicAccountEmail,
                  environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] == Self.publicAccountPassword else {
                throw PreparationError.actualAccountInputNotAllowed
            }
        } else if ["account-upgrade", "account-logout", "account-login", "account-reauthenticate"].contains(flow) {
            guard environment["CYCLEPAIR_SECRET_INPUT_VALIDATED"] == "1",
                  !(environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "").isEmpty,
                  !(environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "").isEmpty else {
                throw PreparationError.secretInputNotValidated
            }
        } else if !(environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "").isEmpty ||
                  !(environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "").isEmpty {
            throw PreparationError.actualAccountInputNotAllowed
        }
        if flow == "sharing-private" {
            // This flow explicitly requires the already-open sharing screen.
            app.activate()
        } else {
            // A fresh UI session must attach to the app's accessible window.
            // Normal process restart preserves the account and saved records.
            if app.state != .notRunning { app.terminate() }
            app.launch()
        }
    }

    func testStartFromOnboarding() {
        let next = element("onboarding-next")
        XCTAssertTrue(next.waitForExistence(timeout: 120), "새 합성 계정의 첫 안내가 선행 조건입니다.")
        XCTAssertTrue(text(["Example", "예시"]).exists, "기록 예시임을 표시해야 합니다.")
        next.tap()
        let consent = element("setup-consent")
        reveal(consent)
        XCTAssertTrue(consent.isHittable, "동의 항목을 실제로 읽고 선택할 수 있어야 합니다.")
        consent.tap()
        let save = element("setup-save")
        reveal(save)
        XCTAssertTrue(save.isEnabled, "동의 뒤 첫 설정을 저장할 수 있어야 합니다.")
        save.tap()
        XCTAssertTrue(element("home-record").waitForExistence(timeout: 30), "설정 저장 뒤 홈으로 이동해야 합니다.")
    }

    func testInvitationInputCanary() {
        tap("tab-partner")
        tapButton(["Connect a partner", "파트너 연결"])
        tapButton(["Receive invitation", "초대 받기"])
        let input = element("invite-input")
        XCTAssertTrue(input.waitForExistence(timeout: 15), "초대 입력란이 실제 화면에 있어야 합니다.")
        reveal(input)
        XCTAssertTrue(input.isEnabled && input.isHittable, "초대 입력란을 실제로 사용할 수 있어야 합니다.")
        let existing = input.value as? String ?? ""
        let emptyValues = ["", "Paste your invitation code", "받은 초대 코드를 붙여 넣어주세요"]
        guard emptyValues.contains(existing) || existing == Self.publicCanary else {
            XCTFail("기존 입력을 덮어쓰지 않습니다. 빈 입력란 또는 공개 canary만 허용합니다.")
            return
        }
        if existing != Self.publicCanary {
            input.tap()
            input.typeText(Self.publicCanary)
        }
        let matches = wait { (input.value as? String) == Self.publicCanary }
        XCTAssertTrue(matches, "공개 canary 입력 결과가 원문과 같아야 합니다.")
        // Never invoke Connect, Create invitation or any backend acceptance.
        tapButton(["Close", "닫기"])
        XCTAssertTrue(element("tab-partner").waitForExistence(timeout: 15), "닫기 뒤 기본 탐색으로 돌아와야 합니다.")
        XCTAssertTrue(wait { !self.element("invite-input").exists }, "초대 입력 화면을 제출 없이 닫아야 합니다.")
        print("CP_COORDINATED_CANARY inputMatches=true closed=true connectInvoked=false")
    }

    func testAccountInputCanary() {
        XCTAssertTrue(element("home-record").waitForExistence(timeout: 120), "소유 게스트의 홈이 선행 조건입니다.")
        tap("tab-settings")
        let account = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@",
            "Account and recovery", "계정과 복구")).firstMatch
        reveal(account)
        XCTAssertTrue(account.isHittable, "계정 설정을 실제로 열 수 있어야 합니다.")
        account.tap()
        let email = app.textFields.matching(NSPredicate(format: "label IN %@", ["New account email", "계정 전환 이메일"])).firstMatch
        let password = app.secureTextFields.matching(NSPredicate(format: "label IN %@", ["New account password", "계정 전환 비밀번호"])).firstMatch
        func empty(_ field: XCUIElement) -> Bool {
            let value = field.value as? String ?? ""
            return value.isEmpty || value == field.placeholderValue
        }
        guard email.waitForExistence(timeout: 15), password.exists, empty(email), empty(password) else {
            closeAccountCanary()
            XCTFail("기존 입력이 없는 게스트 전환 입력란만 사용합니다.")
            return
        }
        reveal(email); email.tap(); email.typeText(Self.publicAccountEmail)
        let emailExact = wait { (email.value as? String) == Self.publicAccountEmail }
        reveal(password); password.tap(); password.typeText(Self.publicAccountPassword)
        let secureMasked = wait {
            SecureFieldObservation.isMasked(isSecure: password.elementType == .secureTextField,
                value: password.value, placeholder: password.placeholderValue)
        }
        closeAccountCanary()
        let closed = wait { !email.exists && !password.exists }
        // 닫기 후 다시 열어 입력이 지워졌는지 확인한다. 계정 만들기는 누르지 않는다.
        reveal(account); account.tap()
        let cleared = email.waitForExistence(timeout: 15) && password.exists && empty(email) && empty(password)
        closeAccountCanary()
        let closedAgain = wait { !email.exists }
        print("CP_ACCOUNT_CANARY_OBSERVATION emailExact=\(emailExact) secureMaskedNonemptyOnly=\(secureMasked) closed=\(closed) cleared=\(cleared) closedAgain=\(closedAgain) submitted=false authenticated=false")
        XCTAssertTrue(emailExact, "공개 이메일 입력이 일치해야 합니다.")
        XCTAssertTrue(secureMasked, "보안 입력란에 비어 있지 않은 마스크 값이 보여야 합니다.")
        XCTAssertTrue(closed, "제출 없이 계정 입력 화면을 닫아야 합니다.")
        XCTAssertTrue(cleared, "다시 연 계정 입력이 비어 있어야 합니다.")
        XCTAssertTrue(closedAgain, "다시 연 입력도 제출 없이 닫아야 합니다.")
        print("CP_ACCOUNT_CANARY emailExact=true secureMaskedNonemptyOnly=true closed=true submitted=false authenticated=false")
    }

    private func closeAccountCanary() {
        let back = button(["Back", "뒤로"])
        for _ in 0..<12 {
            if back.exists && back.isHittable { back.tap(); return }
            app.swipeDown(velocity: .slow)
        }
        XCTFail("계정 입력을 제출하지 않고 닫아야 합니다.")
    }

    func testAccountUpgrade() {
        openAccountSettings()
        let environment = ProcessInfo.processInfo.environment
        fillEmptyAccountField(accountEmail(), environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "")
        fillEmptyAccountField(accountPassword(), environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "")
        let confirmation = app.secureTextFields.matching(NSPredicate(format: "label IN %@",
            ["Confirm new account password", "계정 전환 비밀번호 확인"])).firstMatch
        fillEmptyAccountField(confirmation, environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "")
        let submit = element("account-upgrade-submit")
        dismissAccountKeyboard()
        reveal(submit); submit.tap()
        let verification = app.secureTextFields.matching(NSPredicate(format: "label IN %@",
            ["Current password for verification", "재인증 비밀번호"])).firstMatch
        XCTAssertTrue(verification.waitForExistence(timeout: 60), "계정 전환 뒤 재인증 입력을 표시해야 합니다.")
        XCTAssertFalse(submit.exists, "게스트 전환 입력이 남으면 안 됩니다.")
        XCTAssertTrue(text(["Unverified", "미인증"]).exists, "전환 뒤 아직 이메일 인증 전임을 표시해야 합니다.")
        closeAccountCanary()
        tap("tab-home")
        XCTAssertTrue(element("home-record").waitForExistence(timeout: 30))
        print("CP_ACCOUNT_AUTH action=upgrade uiCompleted=true emailVerified=false")
    }

    func testAccountLogout() {
        openAccountSettings()
        let signOut = button(["Sign out", "로그아웃"])
        reveal(signOut); signOut.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 10), "로그아웃 확인창이 있어야 합니다.")
        alert.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "취소"])).firstMatch.tap()
        XCTAssertTrue(wait { !alert.exists }, "취소하면 계정 화면에 남아야 합니다.")
        XCTAssertTrue(signOut.exists)
        reveal(signOut); signOut.tap()
        XCTAssertTrue(alert.waitForExistence(timeout: 10))
        alert.buttons.matching(NSPredicate(format: "label IN %@", ["Sign out", "로그아웃"])).firstMatch.tap()
        XCTAssertTrue(element("account-login-submit").waitForExistence(timeout: 60), "정상 로그아웃 뒤 로그인 화면이 있어야 합니다.")
        restartForObservation(waitingFor: "account-login-submit")
        XCTAssertTrue(element("account-login-submit").exists, "재실행 뒤 로그아웃 상태가 유지되어야 합니다.")
        XCTAssertFalse(element("home-record").exists, "로그아웃 뒤 기존 기록의 홈이 노출되면 안 됩니다.")
        print("CP_ACCOUNT_AUTH action=logout uiCompleted=true coldRestartGate=true")
    }

    func testAccountLogin() {
        XCTAssertTrue(element("account-login-submit").waitForExistence(timeout: 120), "정상 로그아웃된 로그인 화면이 선행 조건입니다.")
        let environment = ProcessInfo.processInfo.environment
        let email = app.textFields.matching(NSPredicate(format: "label IN %@", ["Sign-in email", "로그인 이메일"])).firstMatch
        let password = app.secureTextFields.matching(NSPredicate(format: "label IN %@", ["Sign-in password", "로그인 비밀번호"])).firstMatch
        fillEmptyAccountField(email, environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "")
        fillEmptyAccountField(password, environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "")
        dismissAccountKeyboard()
        let submit = element("account-login-submit")
        reveal(submit); submit.tap()
        XCTAssertTrue(element("home-record").waitForExistence(timeout: 60), "정상 로그인 뒤 홈이 열려야 합니다.")
        restartForObservation()
        XCTAssertTrue(element("home-record").waitForExistence(timeout: 120), "재실행 뒤 로그인 상태가 복원되어야 합니다.")
        print("CP_ACCOUNT_AUTH action=login uiCompleted=true coldRestartHome=true")
    }

    func testAccountReauthenticate() {
        openAccountSettings()
        let notice = text(["Identity confirmed for this session.", "이 세션에서 본인 확인이 완료되었습니다."])
        XCTAssertFalse(notice.exists, "이전 재인증 결과를 새 성공으로 세지 않습니다.")
        let password = app.secureTextFields.matching(NSPredicate(format: "label IN %@",
            ["Current password for verification", "재인증 비밀번호"])).firstMatch
        fillEmptyAccountField(password, ProcessInfo.processInfo.environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "")
        dismissAccountKeyboard()
        let submit = button(["Confirm password", "비밀번호 확인"])
        reveal(submit); submit.tap()
        XCTAssertTrue(notice.waitForExistence(timeout: 60), "정상 재인증 완료를 표시해야 합니다.")
        reveal(notice)
        XCTAssertTrue(notice.isHittable)
        XCTAssertTrue(wait { self.emptyAccountField(password) }, "재인증 뒤 입력한 비밀번호를 비워야 합니다.")
        closeAccountCanary()
        tap("tab-home")
        print("CP_ACCOUNT_AUTH action=reauthenticate uiCompleted=true passwordCleared=true")
    }

    private func openAccountSettings() {
        XCTAssertTrue(element("home-record").waitForExistence(timeout: 120), "소유 합성 계정의 홈이 선행 조건입니다.")
        tap("tab-settings")
        let account = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@",
            "Account and recovery", "계정과 복구")).firstMatch
        reveal(account); account.tap()
    }

    private func accountEmail() -> XCUIElement {
        app.textFields.matching(NSPredicate(format: "label IN %@", ["New account email", "계정 전환 이메일"])).firstMatch
    }

    private func accountPassword() -> XCUIElement {
        app.secureTextFields.matching(NSPredicate(format: "label IN %@", ["New account password", "계정 전환 비밀번호"])).firstMatch
    }

    private func emptyAccountField(_ field: XCUIElement) -> Bool {
        let value = field.value as? String ?? ""
        return value.isEmpty || value == field.placeholderValue
    }

    private func fillEmptyAccountField(_ field: XCUIElement, _ value: String) {
        XCTAssertTrue(field.waitForExistence(timeout: 15), "정상 계정 입력란이 있어야 합니다.")
        guard !value.isEmpty && emptyAccountField(field) else {
            XCTFail("빈 입력란과 검증된 비공개 입력만 허용합니다.")
            return
        }
        reveal(field); field.tap(); field.typeText(value)
    }

    private func dismissAccountKeyboard() {
        let done = element("keyboard-done")
        if done.exists && done.isHittable { done.tap() }
    }

    func testInvitationAccept() {
        let invitation = ProcessInfo.processInfo.environment["CYCLEPAIR_TEST_INVITATION"] ?? ""
        guard invitation.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
            XCTFail("형식을 검증한 초대 입력만 허용합니다.")
            return
        }
        tap("tab-partner")
        tapButton(["Connect a partner", "파트너 연결"])
        tapButton(["Receive invitation", "초대 받기"])
        let input = element("invite-input")
        XCTAssertTrue(input.waitForExistence(timeout: 15), "초대 입력란이 있어야 합니다.")
        reveal(input)
        let existing = input.value as? String ?? ""
        let emptyValues = ["", "Paste your invitation code", "받은 초대 코드를 붙여 넣어주세요"]
        guard emptyValues.contains(existing) || existing == invitation else {
            XCTFail("기존 초대 입력을 덮어쓰지 않습니다.")
            return
        }
        if existing != invitation {
            input.tap()
            input.typeText(invitation)
        }
        XCTAssertTrue(wait { (input.value as? String) == invitation }, "초대 입력 결과가 원문과 같아야 합니다.")
        let keyboardDone = element("keyboard-done")
        if keyboardDone.waitForExistence(timeout: 3) { keyboardDone.tap() }
        let connect = button(["Connect", "연결하기"])
        reveal(connect)
        XCTAssertTrue(connect.isEnabled && connect.isHittable, "입력한 초대로 실제 연결을 요청할 수 있어야 합니다.")
        connect.tap()
        XCTAssertTrue(element("sharing-save").waitForExistence(timeout: 60), "연결 후 공유 선택 화면이 열려야 합니다.")
        finishPrivateSharing()
    }

    func testSharingPrivate() {
        finishPrivateSharing()
    }

    func testPartnerReceived() {
        tap("tab-partner")
        let calm = text(["Calm", "평온"])
        XCTAssertTrue(calm.waitForExistence(timeout: 30), "공유받은 감정이 표시되어야 합니다.")
        reveal(calm)
        XCTAssertTrue(calm.isHittable, "공유받은 감정을 읽을 수 있는 위치에 표시해야 합니다.")
        let care = text(["Just listen", "그냥 들어줘요"])
        XCTAssertTrue(care.waitForExistence(timeout: 15), "공유받은 원하는 도움이 표시되어야 합니다.")
        reveal(care)
        XCTAssertTrue(care.isHittable, "공유받은 원하는 도움을 읽을 수 있어야 합니다.")
        XCTAssertFalse(text([syntheticNote]).exists, "공유하지 않은 합성 메모가 표시되면 안 됩니다.")
    }

    func testEventReceived() {
        tap("tab-calendar")
        let event = text([syntheticEvent])
        XCTAssertTrue(event.waitForExistence(timeout: 30), "상대가 만든 합성 일정이 있어야 합니다.")
        reveal(event)
        XCTAssertTrue(event.isHittable, "공유 일정의 원문이 화면에 표시되어야 합니다.")
    }

    func testPartnerRevoked() {
        restartForObservation()
        tap("tab-partner")
        let empty = text(["No shared update today", "오늘 공유된 정보 없음"])
        XCTAssertTrue(empty.waitForExistence(timeout: 30), "공유 회수 뒤 빈 상태가 표시되어야 합니다.")
        reveal(empty)
        XCTAssertTrue(empty.isHittable, "공유 회수 뒤 빈 상태를 읽을 수 있어야 합니다.")
        XCTAssertFalse(text(["Calm", "평온"]).exists, "회수한 감정이 남으면 안 됩니다.")
        XCTAssertFalse(text(["Just listen", "그냥 들어줘요"]).exists, "회수한 원하는 도움이 남으면 안 됩니다.")
        XCTAssertFalse(text([syntheticNote]).exists, "공유하지 않은 합성 메모가 표시되면 안 됩니다.")
    }

    func testDisconnectedRestart() {
        restartForObservation()
        tap("tab-partner")
        let connect = button(["Connect a partner", "파트너 연결"])
        XCTAssertTrue(connect.waitForExistence(timeout: 30), "연결 해제 후 연결 카드가 표시되어야 합니다.")
        reveal(connect)
        XCTAssertTrue(connect.isHittable, "연결 해제 상태를 화면에서 확인할 수 있어야 합니다.")
        XCTAssertFalse(text([syntheticEvent]).exists, "연결 해제 뒤 이전 합성 일정이 이 화면에 표시되면 안 됩니다.")
        XCTAssertFalse(text([syntheticNote]).exists, "연결 해제 뒤 합성 메모가 이 화면에 표시되면 안 됩니다.")
    }

    private func finishPrivateSharing() {
        XCTAssertTrue(element("sharing-save").waitForExistence(timeout: 30), "공유 선택 화면이 선행 조건입니다.")
        let heading = text(["Preview for your partner", "상대에게 보이는 모습"])
        reveal(heading)
        XCTAssertTrue(heading.isHittable, "공유 미리보기를 읽을 수 있어야 합니다.")
        let empty = text(["No items selected", "공유 항목을 선택하지 않았어요"])
        reveal(empty)
        XCTAssertTrue(empty.isHittable, "기본 공유 항목이 없음을 실제 화면에서 확인해야 합니다.")
        let save = element("sharing-save")
        reveal(save)
        XCTAssertTrue(save.isEnabled && save.isHittable, "기본 비공개 설정을 저장할 수 있어야 합니다.")
        save.tap()
        XCTAssertTrue(element("tab-partner").waitForExistence(timeout: 30), "공유 저장 뒤 기본 탐색으로 돌아와야 합니다.")
    }

    private func restartForObservation(waitingFor identifier: String = "tab-partner") {
        if app.state != .notRunning { app.terminate() }
        app.launch()
        XCTAssertTrue(element(identifier).waitForExistence(timeout: 120), "자료를 보존한 재실행 뒤 기대한 화면이 있어야 합니다.")
    }

    private func text(_ labels: [String]) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label IN %@", labels)).firstMatch
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func button(_ labels: [String]) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label IN %@", labels)).firstMatch
    }

    private func tap(_ identifier: String) {
        let control = element(identifier)
        XCTAssertTrue(control.waitForExistence(timeout: 15), "지정된 화면 요소가 있어야 합니다.")
        XCTAssertTrue(control.isHittable, "지정된 화면 요소를 실제로 누를 수 있어야 합니다.")
        control.tap()
    }

    private func tapButton(_ labels: [String]) {
        let control = button(labels)
        XCTAssertTrue(control.waitForExistence(timeout: 15), "현재 언어의 버튼이 있어야 합니다.")
        XCTAssertTrue(control.isHittable, "화면의 버튼을 실제로 누를 수 있어야 합니다.")
        control.tap()
    }

    private func reveal(_ control: XCUIElement) {
        for _ in 0..<12 {
            let window = app.windows.firstMatch.frame
            let scrolls = app.descendants(matching: .any).matching(identifier: "screen-scroll").allElementsBoundByIndex
            guard let scroll = scrolls.last(where: { $0.isHittable }) else {
                XCTFail("실제 스크롤 영역을 찾을 수 없습니다.")
                return
            }
            let viewport = window.intersection(scroll.frame)
            if control.exists && control.isHittable && viewport.contains(control.frame) { return }
            scroll.swipeUp(velocity: .slow)
        }
        XCTFail("화면 요소 전체가 실제 스크롤 영역 안에 표시되어야 합니다.")
    }

    private func wait(timeout: TimeInterval = 15, _ condition: @escaping () -> Bool) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    private enum PreparationError: Error {
        case simulatorForbidden
        case approvalOrIsolationMissing
        case syntheticRunIDMissing
        case unsupportedFlow
        case attachmentsMustBeDisabled
        case actualInvitationNotAllowed
        case secretInputNotValidated
        case actualAccountInputNotAllowed
    }
}
