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
        print("Secure field observation: \(cases.count - failed) passed, \(failed) failed")
        if failed > 0 { exit(1) }
    }
}
