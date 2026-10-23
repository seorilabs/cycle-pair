import Foundation

@main
struct SecureFieldObservationTests {
    static func main() {
        let cases: [(String, Bool, Any?, String?, Bool)] = [
            ("one mask", true, "•", "Password", true),
            ("multiple masks", true, "●*•", "Password", true),
            ("full public input length", true, String(repeating: "•", count: 28), nil, true),
            ("missing value", true, nil, nil, false),
            ("non-string value", true, 28, nil, false),
            ("empty value", true, "", nil, false),
            ("placeholder", true, "Password", "Password", false),
            ("masked placeholder", true, "•", "•", false),
            ("plaintext", true, "public-example-password", nil, false),
            ("mixed plaintext and mask", true, "•x", nil, false),
            ("non-secure field", false, "•", nil, false),
        ]
        var failed = 0
        for (name, secure, value, placeholder, expected) in cases {
            if SecureFieldObservation.isMasked(isSecure: secure, value: value, placeholder: placeholder) != expected {
                print("FAIL: \(name)")
                failed += 1
            }
        }
        let confirmations: [(String, Bool, Bool, Bool, Bool, SecureFieldObservation.ConfirmationAction)] = [
            ("fresh empty confirmation", true, true, true, false, .type),
            ("filled during own password input", true, true, false, true, .preserveMasked),
            ("preexisting masked input", false, true, false, true, .reject),
            ("preexisting empty input without preflight", false, true, true, false, .reject),
            ("unexpected plaintext", true, true, false, false, .reject),
            ("nonsecure empty input", true, false, true, false, .reject),
            ("nonsecure masked input", true, false, false, true, .reject),
        ]
        for (name, initial, secure, empty, masked, expected) in confirmations {
            if SecureFieldObservation.confirmationAction(initiallyEmpty: initial, isSecure: secure,
                isEmpty: empty, isMasked: masked) != expected {
                print("FAIL: \(name)")
                failed += 1
            }
        }
        print("Secure field observation: \(cases.count + confirmations.count - failed) passed, \(failed) failed")
        if failed > 0 { exit(1) }
    }
}
