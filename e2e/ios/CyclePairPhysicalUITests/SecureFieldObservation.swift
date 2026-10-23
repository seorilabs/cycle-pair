import Foundation

/// Accessibility masking is an observation, not proof of the entered password.
enum SecureFieldObservation {
    static func isMasked(isSecure: Bool, value: Any?, placeholder: String?) -> Bool {
        guard isSecure, let text = value as? String, !text.isEmpty, text != placeholder else { return false }
        return text.allSatisfy { "•●*".contains($0) }
    }
}
