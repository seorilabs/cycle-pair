import XCTest

/// Separately signed UI runner for an already installed, isolated test account.
final class CyclePairPhysicalUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.seorilabs.cyclepair")
    private var runID = ""
    private var syntheticNote: String { "\(runID)-note" }

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
        coldHome()
    }

    func testColdHomeExposesAccessibleControls() {
        let primary = element("home-record")
        XCTAssertTrue(primary.elementType == .button, "홈 기록 행동이 버튼으로 노출되어야 합니다.")
        XCTAssertTrue(primary.isEnabled, "기록을 불러온 홈 버튼을 사용할 수 있어야 합니다.")
        assertAccessible(primary)
        for identifier in ["tab-home", "tab-calendar", "tab-settings"] {
            let tab = element(identifier)
            XCTAssertTrue(tab.waitForExistence(timeout: 10), "기본 탐색 요소가 있어야 합니다.")
            assertAccessible(tab)
        }
        safeScreenshot("home-cold")
    }

    func testDiagnosticsConsentSurvivesColdRestart() {
        openNotificationsAndPrivacy()
        guard let original = diagnosticsValue() else { return }
        print("CP_DIAGNOSTICS initial=\(original)")
        setDiagnostics(!original)
        coldHome()
        openNotificationsAndPrivacy()
        XCTAssertEqual(diagnosticsValue(), !original, "진단 동의 변경이 재실행 뒤 유지되어야 합니다.")

        setDiagnostics(original)
        coldHome()
        openNotificationsAndPrivacy()
        XCTAssertEqual(diagnosticsValue(), original, "원래 진단 동의가 재실행 뒤 복원되어야 합니다.")
        print("CP_DIAGNOSTICS restored=\(original)")
        tapButton(["Back", "뒤로"])
        tap("tab-home")
        XCTAssertTrue(element("home-record").waitForExistence(timeout: 30))
    }

    func testPrivacyNoticeCanBeReadAndClosed() {
        openNotificationsAndPrivacy()
        let entry = element("privacy-open")
        reveal(entry)
        entry.tap()
        XCTAssertTrue(element("privacy-center").waitForExistence(timeout: 30), "개인정보 안내가 열려야 합니다.")
        let title = app.staticTexts.matching(NSPredicate(format: "label IN %@", [
            "You control your records and sharing", "내 기록과 공유를 직접 통제해요"
        ])).firstMatch
        reveal(title, scrollIdentifier: "privacy-scroll")
        assertAccessible(title)
        let consent = app.staticTexts.matching(NSPredicate(format:
            "label CONTAINS %@ OR label CONTAINS %@", "Health data consent", "민감정보 동의")).firstMatch
        reveal(consent, scrollIdentifier: "privacy-scroll")
        assertAccessible(consent)
        XCTAssertTrue(consent.label.contains("2026-08-09-v1"), "현재 민감정보 동의 버전을 읽을 수 있어야 합니다.")
        let rights = app.staticTexts.matching(NSPredicate(format:
            "label CONTAINS %@ OR label CONTAINS %@",
            "After confirming your current password in account settings", "계정 설정에서 내 데이터를")).firstMatch
        reveal(rights, scrollIdentifier: "privacy-scroll")
        assertAccessible(rights)
        tap("privacy-close")
        XCTAssertTrue(wait { !self.element("privacy-center").exists }, "확인 뒤 안내를 닫아야 합니다.")
        XCTAssertTrue(element("diagnostics-toggle").exists, "원래 알림과 개인정보 설정으로 돌아와야 합니다.")
        tapButton(["Back", "뒤로"])
        tap("tab-home")
        XCTAssertTrue(element("home-record").waitForExistence(timeout: 30))
    }

    func testLanguageChangeSurvivesColdRestart() {
        openLanguage()
        let original = ["system", "ko", "en"].first {
            element("language-\($0)").label.contains("✓")
        }
        XCTAssertNotNil(original, "현재 언어 선택이 화면에 표시되어야 합니다.")

        chooseLanguage("en", selectedLabel: "✓ English")
        closeLanguage()
        tap("tab-home")
        assertTitle("My day")
        coldHome()
        assertTitle("My day")
        safeScreenshot("home-en")

        openLanguage()
        chooseLanguage("ko", selectedLabel: "✓ 한국어")
        closeLanguage()
        tap("tab-home")
        assertTitle("나의 오늘")
        coldHome()
        assertTitle("나의 오늘")
        safeScreenshot("home-ko")

        if let original, original != "ko" {
            openLanguage()
            tap("language-\(original)")
            XCTAssertTrue(wait { self.element("language-\(original)").label.contains("✓") },
                          "원래 언어 선택으로 되돌아가야 합니다.")
            closeLanguage()
            tap("tab-home")
        }
    }

    func testRecordSurvivesColdRestart() {
        tap("home-record")
        tap("record-emotions")
        let calm = element("record-emotion-calm")
        XCTAssertTrue(calm.waitForExistence(timeout: 10), "감정 선택 화면이 열려야 합니다.")
        if !calm.isSelected { calm.tap() }
        XCTAssertTrue(wait { calm.isSelected }, "평온 선택 상태가 표시되어야 합니다.")
        tapButton(["Done", "완료"])

        tap("record-help")
        let help = element("record-help-2")
        XCTAssertTrue(help.waitForExistence(timeout: 10), "원하는 도움을 고를 수 있어야 합니다.")
        if !help.isSelected { help.tap() }
        XCTAssertTrue(wait { help.isSelected }, "선택한 도움 상태가 표시되어야 합니다.")
        tapButton(["Done", "완료"])

        tap("record-details")
        let note = element("record-note")
        reveal(note)
        assertAccessible(note)
        let existing = note.value as? String ?? ""
        let placeholders = ["", "Add a note", "남기고 싶은 내용을 적어주세요"]
        guard placeholders.contains(existing) || existing == syntheticNote else {
            XCTFail("기존 메모를 덮어쓰지 않습니다. 격리된 빈 기록 또는 같은 실행의 메모가 필요합니다.")
            return
        }
        if existing != syntheticNote {
            note.tap()
            note.typeText(syntheticNote)
        }
        let keyboardDone = element("keyboard-done")
        if keyboardDone.waitForExistence(timeout: 3) { keyboardDone.tap() }
        let save = element("record-save")
        reveal(save)
        XCTAssertTrue(save.isEnabled, "기록 저장 버튼을 사용할 수 있어야 합니다.")
        save.tap()
        XCTAssertTrue(element("home-record").waitForExistence(timeout: 60),
                      "저장 완료 뒤 홈으로 돌아와야 합니다.")
        XCTAssertTrue(wait {
            self.app.staticTexts.matching(NSPredicate(format: "label == %@ OR label == %@", "✓ Recorded", "✓ 기록 완료")).firstMatch.exists
        }, "기록 완료 상태가 표시되어야 합니다.")

        coldHome()
        let calmSummary = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Calm", "평온")).firstMatch
        XCTAssertTrue(calmSummary.waitForExistence(timeout: 30), "재실행 후 감정 요약이 복원되어야 합니다.")
        tap("tab-calendar")
        let viewRecord = button(["View record", "기록 보기"])
        reveal(viewRecord)
        viewRecord.tap()
        let restoredNote = app.staticTexts.matching(NSPredicate(format: "label == %@", syntheticNote)).firstMatch
        XCTAssertTrue(restoredNote.waitForExistence(timeout: 30), "재실행 후 기록 상세의 합성 메모 원문이 복원되어야 합니다.")
        safeScreenshot("record-restored")
        tapButton(["Back", "뒤로"])
        tap("tab-home")
    }

    private func coldHome() {
        if app.state != .notRunning { app.terminate() }
        app.launch()
        XCTAssertTrue(element("home-record").waitForExistence(timeout: 120),
                      "로그인과 첫 설정을 완료한 격리 계정의 홈이 필요합니다. 앱 자료를 초기화하거나 설정을 우회하지 않습니다.")
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func tap(_ identifier: String) {
        let control = element(identifier)
        XCTAssertTrue(control.waitForExistence(timeout: 15), "지정된 화면 요소가 있어야 합니다.")
        XCTAssertTrue(control.isHittable, "지정된 화면 요소를 실제로 누를 수 있어야 합니다.")
        control.tap()
    }

    private func button(_ labels: [String]) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label IN %@", labels)).firstMatch
    }

    private func tapButton(_ labels: [String]) {
        let control = button(labels)
        XCTAssertTrue(control.waitForExistence(timeout: 15), "현재 언어의 버튼이 있어야 합니다.")
        XCTAssertTrue(control.isHittable, "화면의 버튼을 실제로 누를 수 있어야 합니다.")
        control.tap()
    }

    private func openNotificationsAndPrivacy() {
        tap("tab-settings")
        let section = app.buttons.matching(NSPredicate(format:
            "label CONTAINS %@ OR label CONTAINS %@", "Notifications and privacy", "알림과 개인정보")).firstMatch
        XCTAssertTrue(section.waitForExistence(timeout: 15))
        reveal(section)
        section.tap()
        XCTAssertTrue(element("diagnostics-toggle").waitForExistence(timeout: 30))
    }

    private func diagnosticsValue() -> Bool? {
        let control = element("diagnostics-toggle")
        reveal(control)
        XCTAssertTrue(wait { control.isEnabled }, "진단 설정 처리가 완료되어야 합니다.")
        guard let value = control.value as? String, value == "0" || value == "1" else {
            XCTFail("진단 동의의 켜짐과 꺼짐 상태를 읽을 수 있어야 합니다.")
            return nil
        }
        return value == "1"
    }

    private func setDiagnostics(_ enabled: Bool) {
        guard let current = diagnosticsValue() else { return }
        XCTAssertNotEqual(current, enabled, "반전 또는 원복 전 상태가 기대와 같아야 합니다.")
        let control = element("diagnostics-toggle")
        control.tap()
        XCTAssertTrue(wait(timeout: 30) {
            control.isEnabled && (control.value as? String) == (enabled ? "1" : "0")
        }, "진단 동의 선택이 실제 화면에 적용되어야 합니다.")
    }

    private func openLanguage() {
        tap("tab-settings")
        let language = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Language", "언어")).firstMatch
        reveal(language)
        language.tap()
        XCTAssertTrue(element("language-en").waitForExistence(timeout: 15), "언어 선택 화면이 열려야 합니다.")
    }

    private func chooseLanguage(_ code: String, selectedLabel: String) {
        tap("language-\(code)")
        XCTAssertTrue(wait { self.element("language-\(code)").label.contains(selectedLabel) },
                      "선택한 언어가 화면에 반영되어야 합니다.")
    }

    private func closeLanguage() { tapButton(["Back", "뒤로"]) }

    private func assertTitle(_ title: String) {
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label == %@", title)).firstMatch.waitForExistence(timeout: 15),
                      "선택한 언어로 홈 제목이 표시되어야 합니다.")
    }

    private func assertAccessible(_ control: XCUIElement) {
        XCTAssertFalse(control.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                       "화면 읽기에서 사용할 이름이 있어야 합니다.")
        XCTAssertTrue(control.isHittable, "접근성 요소의 화면 위치를 사용할 수 있어야 합니다.")
    }

    private func reveal(_ control: XCUIElement, scrollIdentifier: String = "screen-scroll") {
        for _ in 0..<12 {
            let window = app.windows.firstMatch.frame
            let scrolls = app.descendants(matching: .any).matching(identifier: scrollIdentifier).allElementsBoundByIndex
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

    private func safeScreenshot(_ name: String) {
        guard ProcessInfo.processInfo.environment["CYCLEPAIR_CAPTURE_SAFE_SCREENS"] == "1" else { return }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private enum PreparationError: Error {
        case simulatorForbidden
        case approvalOrIsolationMissing
        case syntheticRunIDMissing
    }
}
