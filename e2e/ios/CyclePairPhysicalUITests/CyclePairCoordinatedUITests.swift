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
            "testEmailVerificationRequested": "email-verification-request",
            "testEmailVerificationRefreshed": "email-verification-refresh",
            "testPasswordResetRequested": "password-reset-request",
            "testPasswordResetOldPasswordRejected": "password-reset-old-rejected",
            "testPasswordResetLogin": "password-reset-login",
            "testEmailVerificationBrowserAction": "email-verification-browser",
            "testAccountDeleted": "account-delete",
            "testAccountExportRequested": "account-export-request",
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
        if flow == "email-verification-browser" {
            guard environment["CYCLEPAIR_SECRET_INPUT_VALIDATED"] == "1",
                  let value = environment["CYCLEPAIR_TEST_ACTION_URL"], !value.isEmpty,
                  (environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "").isEmpty,
                  (environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "").isEmpty else {
                throw PreparationError.secretInputNotValidated
            }
        } else if !(environment["CYCLEPAIR_TEST_ACTION_URL"] ?? "").isEmpty {
            throw PreparationError.actualAccountInputNotAllowed
        } else if flow == "account-input-canary" {
            guard environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] == Self.publicAccountEmail,
                  environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] == Self.publicAccountPassword else {
                throw PreparationError.actualAccountInputNotAllowed
            }
        } else if ["email-verification-request", "email-verification-refresh"].contains(flow) {
            guard environment["CYCLEPAIR_SECRET_INPUT_VALIDATED"] == "1",
                  (environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "").isEmpty,
                  (environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "").isEmpty else {
                throw PreparationError.actualAccountInputNotAllowed
            }
        } else if flow == "password-reset-request" {
            guard environment["CYCLEPAIR_SECRET_INPUT_VALIDATED"] == "1",
                  !(environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "").isEmpty,
                  (environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "").isEmpty else {
                throw PreparationError.secretInputNotValidated
            }
        } else if ["account-upgrade", "account-logout", "account-login", "account-reauthenticate",
                   "password-reset-old-rejected", "password-reset-login", "account-delete", "account-export-request"].contains(flow) {
            guard environment["CYCLEPAIR_SECRET_INPUT_VALIDATED"] == "1",
                  !(environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "").isEmpty,
                  !(environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "").isEmpty else {
                throw PreparationError.secretInputNotValidated
            }
        } else if !(environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "").isEmpty ||
                  !(environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "").isEmpty {
            throw PreparationError.actualAccountInputNotAllowed
        }
        if flow == "account-delete" && environment["CYCLEPAIR_ACCOUNT_DELETION_APPROVED"] != "1" {
            throw PreparationError.secretInputNotValidated
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
        let confirmation = accountConfirmation()
        func empty(_ field: XCUIElement) -> Bool {
            let value = field.value as? String ?? ""
            return value.isEmpty || value == field.placeholderValue
        }
        let confirmationInitiallyEmpty = confirmation.waitForExistence(timeout: 15) && empty(confirmation)
        guard email.waitForExistence(timeout: 15), password.exists,
              empty(email), empty(password), confirmationInitiallyEmpty else {
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
        fillFreshAccountConfirmation(confirmation, Self.publicAccountPassword,
                                     initiallyEmpty: confirmationInitiallyEmpty)
        closeAccountCanary()
        let closed = wait { !email.exists && !password.exists }
        // 닫기 후 다시 열어 입력이 지워졌는지 확인한다. 계정 만들기는 누르지 않는다.
        reveal(account); account.tap()
        let cleared = email.waitForExistence(timeout: 15) && password.exists && confirmation.exists &&
            empty(email) && empty(password) && empty(confirmation)
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
        let confirmation = accountConfirmation()
        let confirmationInitiallyEmpty = confirmation.waitForExistence(timeout: 15) && emptyAccountField(confirmation)
        guard accountEmail().waitForExistence(timeout: 15), accountPassword().exists, confirmation.exists,
              emptyAccountField(accountEmail()), emptyAccountField(accountPassword()), confirmationInitiallyEmpty else {
            XCTFail("입력 전에 비어 있는 소유 게스트 전환 폼이 필요합니다.")
            return
        }
        fillEmptyAccountField(accountEmail(), environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "")
        fillEmptyAccountField(accountPassword(), environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "")
        fillFreshAccountConfirmation(confirmation, environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "",
                                     initiallyEmpty: confirmationInitiallyEmpty)
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
        signInAndObserveRestore()
        print("CP_ACCOUNT_AUTH action=login uiCompleted=true coldRestartHome=true")
    }

    private func signInAndObserveRestore() {
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

    func testEmailVerificationRequested() {
        openAccountSettings()
        XCTAssertTrue(text(["Unverified", "미인증"]).exists, "미인증 소유 계정이 선행 조건입니다.")
        let refresh = button(["Refresh verification status", "인증 여부 새로고침"])
        reveal(refresh); refresh.tap()
        let pending = text(["Email not yet verified. Open the email link and check again.",
                            "아직 인증되지 않았습니다. 메일의 링크를 연 뒤 다시 확인해 주세요."])
        XCTAssertTrue(pending.waitForExistence(timeout: 60), "외부 인증 전 새로고침은 미인증 안내를 표시해야 합니다.")
        let sent = text(["Verification email sent again.", "인증 메일을 다시 보냈습니다."])
        XCTAssertFalse(sent.exists, "기존 발송 안내를 이번 성공으로 세지 않습니다.")
        let resend = button(["Resend verification email", "인증 메일 다시 보내기"])
        reveal(resend); resend.tap()
        XCTAssertTrue(sent.waitForExistence(timeout: 60), "앱의 메일 요청 완료 안내가 있어야 합니다.")
        XCTAssertTrue(text(["Unverified", "미인증"]).exists, "요청만으로 인증 완료가 되면 안 됩니다.")
        closeAccountCanary(); tap("tab-home")
        print("CP_ACCOUNT_LIFECYCLE action=verification-request requested=true deliveryVerified=false")
    }

    func testEmailVerificationRefreshed() {
        // 외부 메일 action은 이 메서드에서 수행하지 않는다.
        openAccountSettings()
        let refresh = button(["Refresh verification status", "인증 여부 새로고침"])
        XCTAssertTrue(refresh.waitForExistence(timeout: 15), "아직 새로고침하지 않은 인증 화면이 필요합니다.")
        reveal(refresh); refresh.tap()
        let verified = text(["Verified", "인증됨"])
        XCTAssertTrue(verified.waitForExistence(timeout: 60), "외부 인증 뒤 앱 새로고침으로 인증됨을 표시해야 합니다.")
        XCTAssertTrue(text(["Email verification confirmed.", "이메일 인증을 확인했습니다."]).exists)
        XCTAssertFalse(refresh.exists)
        XCTAssertFalse(button(["Resend verification email", "인증 메일 다시 보내기"]).exists)
        closeAccountCanary(); tap("tab-home")
        restartForObservation()
        openAccountSettings()
        XCTAssertTrue(verified.exists, "정상 재실행 뒤에도 인증됨을 유지해야 합니다.")
        XCTAssertFalse(refresh.exists)
        closeAccountCanary(); tap("tab-home")
        print("CP_ACCOUNT_LIFECYCLE action=verification-refresh verified=true coldRestartVerified=true")
    }

    func testPasswordResetRequested() {
        XCTAssertTrue(element("account-login-submit").waitForExistence(timeout: 120), "로그아웃한 소유 계정의 로그인 화면이 필요합니다.")
        let email = signInEmail()
        XCTAssertTrue(email.exists && emptyAccountField(email), "기존 이메일 입력을 덮어쓰지 않습니다.")
        tapButton(["Forgot password", "비밀번호를 잊었어요"])
        XCTAssertTrue(element("account-reset-submit").waitForExistence(timeout: 15))
        XCTAssertFalse(signInPassword().exists, "재설정 요청에는 비밀번호 입력이 없어야 합니다.")
        tapButton(["Back to sign in", "로그인으로 돌아가기"])
        XCTAssertTrue(element("account-login-submit").waitForExistence(timeout: 15))
        XCTAssertTrue(emptyAccountField(signInPassword()))
        tapButton(["Forgot password", "비밀번호를 잊었어요"])
        fillEmptyAccountField(email, ProcessInfo.processInfo.environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "")
        dismissAccountKeyboard()
        let submit = element("account-reset-submit")
        reveal(submit); submit.tap()
        XCTAssertTrue(text(["If this email is registered, a password reset email will be sent.",
                            "등록된 계정이라면 비밀번호 재설정 메일이 전송됩니다."]).waitForExistence(timeout: 60),
                      "계정 존재 여부를 공개하지 않는 발송 안내가 있어야 합니다.")
        XCTAssertFalse(signInPassword().exists)
        XCTAssertFalse(element("home-record").exists)
        tapButton(["Back to sign in", "로그인으로 돌아가기"])
        XCTAssertTrue(element("account-login-submit").waitForExistence(timeout: 15))
        XCTAssertTrue(emptyAccountField(signInPassword()))
        print("CP_ACCOUNT_LIFECYCLE action=password-reset-request requested=true deliveryVerified=false")
    }

    func testPasswordResetOldPasswordRejected() {
        // 외부 서비스에서 재설정을 완료한 뒤에만 이 흐름을 실행한다.
        XCTAssertTrue(element("account-login-submit").waitForExistence(timeout: 120), "정상 로그인 화면이 필요합니다.")
        let environment = ProcessInfo.processInfo.environment
        fillEmptyAccountField(signInEmail(), environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? "")
        fillEmptyAccountField(signInPassword(), environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "")
        dismissAccountKeyboard()
        let submit = element("account-login-submit")
        reveal(submit); submit.tap()
        XCTAssertTrue(text(["Email or password is incorrect.", "이메일 또는 비밀번호가 올바르지 않습니다."]).waitForExistence(timeout: 60),
                      "이전 비밀번호의 정상 로그인 요청을 거절해야 합니다.")
        XCTAssertTrue(submit.exists)
        XCTAssertFalse(element("home-record").exists)
        // 자신의 실패 입력은 앱의 정상 모드 전환으로만 비운다.
        tapButton(["Forgot password", "비밀번호를 잊었어요"])
        XCTAssertTrue(element("account-reset-submit").waitForExistence(timeout: 15))
        tapButton(["Back to sign in", "로그인으로 돌아가기"])
        XCTAssertTrue(signInPassword().waitForExistence(timeout: 15))
        XCTAssertTrue(emptyAccountField(signInPassword()), "이전 비밀번호 초안을 비워야 합니다.")
        print("CP_ACCOUNT_LIFECYCLE action=password-reset-old-rejected rejected=true draftCleared=true")
    }

    func testPasswordResetLogin() {
        signInAndObserveRestore()
        print("CP_ACCOUNT_LIFECYCLE action=password-reset-login authenticated=true coldRestartHome=true")
    }

    func testEmailVerificationBrowserAction() throws {
        let value = ProcessInfo.processInfo.environment["CYCLEPAIR_TEST_ACTION_URL"] ?? ""
        guard let url = URLComponents(string: value), url.path == "/emulator/action",
              url.queryItems?.filter({ $0.name == "mode" }).map({ $0.value }) == ["verifyEmail"] else {
            throw PreparationError.secretInputNotValidated
        }
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate() // Safari를 종료하거나 기존 탭을 초기화하지 않는다.
        let tabs = safari.buttons.matching(NSPredicate(format: "label IN %@", ["Tabs", "Show Tabs", "탭", "탭 보기"])).firstMatch
        guard tabs.waitForExistence(timeout: 15), tabs.isHittable else {
            throw PreparationError.browserSelectorsNotObserved
        }
        tabs.press(forDuration: 1.2)
        let newPrivate = safari.buttons.matching(NSPredicate(format: "label IN %@", ["New Private Tab", "새로운 개인정보 보호 탭"])).firstMatch
        guard newPrivate.waitForExistence(timeout: 10), newPrivate.isHittable else {
            throw PreparationError.browserSelectorsNotObserved
        }
        newPrivate.tap() // 새 탭을 만들기 전에는 URL을 입력하지 않는다.
        let address = safari.textFields.matching(identifier: "URL").firstMatch
        guard address.waitForExistence(timeout: 15), address.isHittable else {
            throw PreparationError.browserSelectorsNotObserved
        }
        let current = address.value as? String ?? ""
        guard current.isEmpty || current == address.placeholderValue else {
            throw PreparationError.browserSelectorsNotObserved
        }
        address.tap(); address.typeText(value + "\n")
        let success = safari.staticTexts.matching(NSPredicate(format: "label CONTAINS %@",
            "The email has been successfully verified.")).firstMatch
        XCTAssertTrue(success.waitForExistence(timeout: 60), "현재 구현은 Auth Emulator의 인증 완료 표시를 확인합니다.")
        // 미관찰 선택자는 ready=false다. 성공해도 기존 다른 탭을 닫지 않는다.
        tabs.press(forDuration: 1.2)
        let close = safari.buttons.matching(NSPredicate(format: "label IN %@", ["Close This Tab", "이 탭 닫기"])).firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 10) && close.isHittable, "이번 새 탭만 닫을 수 있어야 합니다.")
        close.tap()
        app.activate()
        print("CP_ACCOUNT_LIFECYCLE action=verification-browser localHandlerVerified=true")
    }

    func testAccountDeleted() {
        openAccountSettings()
        let owner = ProcessInfo.processInfo.environment["CYCLEPAIR_TEST_ACCOUNT_EMAIL"] ?? ""
        XCTAssertTrue(text([owner]).exists, "삭제 전 표시된 소유 이메일 계정이 일치해야 합니다.")
        let delete = button(["Permanently delete account and records", "계정과 서버 데이터 영구 삭제"])
        reveal(delete); delete.tap()
        XCTAssertTrue(text(["Confirm your current password before deleting your account.",
                            "계정 삭제 전에 현재 비밀번호를 다시 확인해 주세요."]).exists)
        XCTAssertFalse(app.alerts.firstMatch.exists, "최근 재인증 전에는 최종 삭제창을 열면 안 됩니다.")
        reauthenticateOpenAccount()
        reveal(delete); delete.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 10))
        XCTAssertTrue(alert.staticTexts.matching(NSPredicate(format: "label IN %@",
            ["Permanently delete account and data?", "계정과 데이터를 영구 삭제할까요?"])).firstMatch.exists)
        alert.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "취소"])).firstMatch.tap()
        XCTAssertTrue(wait { !alert.exists })
        XCTAssertTrue(text([owner]).exists, "취소 뒤 소유 계정을 유지해야 합니다.")
        reveal(delete); delete.tap()
        XCTAssertTrue(alert.waitForExistence(timeout: 10))
        alert.buttons.matching(NSPredicate(format: "label IN %@", ["Delete permanently", "영구 삭제"])).firstMatch.tap()
        XCTAssertTrue(element("account-login-submit").waitForExistence(timeout: 90), "정상 삭제 뒤 로그인 화면을 표시해야 합니다.")
        XCTAssertTrue(text(["Your account and records on this device have been deleted.",
                            "계정과 이 기기에 저장된 데이터를 삭제했습니다."]).exists)
        XCTAssertFalse(element("home-record").exists)
        restartForObservation(waitingFor: "account-login-submit")
        XCTAssertFalse(element("home-record").exists)
        print("CP_ACCOUNT_LIFECYCLE action=delete uiGate=true coldGate=true serverDeletionIndependentlyVerified=false")
    }

    func testAccountExportRequested() throws {
        // runner 구성과 Safari/Files 공개 선택자 진단이 완료되기 전에는 wrapper도 ready=false다.
        guard Bundle.main.object(forInfoDictionaryKey: "UIFileSharingEnabled") as? Bool == true,
              Bundle.main.object(forInfoDictionaryKey: "LSSupportsOpeningDocumentsInPlace") as? Bool == true else {
            throw PreparationError.exportInboxNotConfigured
        }
        let inbox = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CyclePairExports").appendingPathComponent(runID)
        guard !FileManager.default.fileExists(atPath: inbox.path) else { throw PreparationError.exportInboxNotConfigured }
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
        openAccountSettings()
        let export = button(["Download my data as JSON", "내 데이터 JSON 다운로드"])
        reveal(export); export.tap()
        XCTAssertTrue(text(["Confirm your current password before exporting data.",
                            "데이터 내보내기 전에 현재 비밀번호를 다시 확인해 주세요."]).exists)
        reauthenticateOpenAccount()
        reveal(export); export.tap() // 제품의 Linking.openURL을 통해 정상 브라우저로 이동한다.
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(wait(timeout: 60) { safari.state == .runningForeground })
        let started = safari.staticTexts.matching(NSPredicate(format: "label IN %@",
            ["The download has started. This link cannot be used again.", "다운로드를 시작했습니다. 이 링크는 다시 사용할 수 없습니다."])).firstMatch
        XCTAssertTrue(started.waitForExistence(timeout: 60), "앱 요청과 브라우저 다운로드 시작은 별도 단계입니다.")
        // 이 메서드는 앱 요청과 시작 표시까지만 담당한다. Files 저장과 실제 파일 대조는 후속 단계다.
        app.activate()
        print("CP_ACCOUNT_LIFECYCLE action=export-request browserStarted=true fileReadbackVerified=false")
    }

    private func reauthenticateOpenAccount() {
        let password = app.secureTextFields.matching(NSPredicate(format: "label IN %@",
            ["Current password for verification", "재인증 비밀번호"])).firstMatch
        fillEmptyAccountField(password, ProcessInfo.processInfo.environment["CYCLEPAIR_TEST_ACCOUNT_PASSWORD"] ?? "")
        dismissAccountKeyboard()
        let submit = button(["Confirm password", "비밀번호 확인"])
        reveal(submit); submit.tap()
        XCTAssertTrue(text(["Identity confirmed for this session.", "이 세션에서 본인 확인이 완료되었습니다."]).waitForExistence(timeout: 60))
        XCTAssertTrue(wait { self.emptyAccountField(password) })
    }

    private func signInEmail() -> XCUIElement {
        app.textFields.matching(NSPredicate(format: "label IN %@", ["Sign-in email", "로그인 이메일"])).firstMatch
    }

    private func signInPassword() -> XCUIElement {
        app.secureTextFields.matching(NSPredicate(format: "label IN %@", ["Sign-in password", "로그인 비밀번호"])).firstMatch
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

    private func accountConfirmation() -> XCUIElement {
        app.secureTextFields.matching(NSPredicate(format: "label IN %@",
            ["Confirm new account password", "계정 전환 비밀번호 확인"])).firstMatch
    }

    private func fillFreshAccountConfirmation(_ field: XCUIElement, _ value: String, initiallyEmpty: Bool) {
        guard !value.isEmpty, field.waitForExistence(timeout: 15) else {
            XCTFail("검증된 입력과 확인란이 필요합니다.")
            return
        }
        let observedValue = field.value
        let placeholder = field.placeholderValue
        let text = observedValue as? String ?? ""
        let action = SecureFieldObservation.confirmationAction(initiallyEmpty: initiallyEmpty,
            isSecure: field.elementType == .secureTextField, isEmpty: text.isEmpty || text == placeholder,
            isMasked: SecureFieldObservation.isMasked(isSecure: field.elementType == .secureTextField,
                value: observedValue, placeholder: placeholder))
        switch action {
        case .type:
            dismissAccountKeyboard()
            reveal(field)
            field.tap(); field.typeText(value)
        case .preserveMasked:
            // 이번 입력 전에 빈 칸이 비밀번호 입력 중 채워진 경우만 보존한다.
            // 마스크는 원문 일치 근거가 아니며 정상 제출과 후속 로그인으로 확인한다.
            break
        case .reject:
            XCTFail("처음 빈 확인란의 새 보안 입력만 허용합니다.")
        }
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
        case browserSelectorsNotObserved
        case exportInboxNotConfigured
    }
}
