import Foundation

/// Accessibility masking is an observation, not proof of the entered password.
enum SecureFieldObservation {
    enum ConfirmationAction: Equatable {
        case reject, type, preserveMasked
    }

    static func confirmationAction(initiallyEmpty: Bool, isSecure: Bool,
                                   isEmpty: Bool, isMasked: Bool) -> ConfirmationAction {
        guard initiallyEmpty, isSecure else { return .reject }
        if isEmpty { return .type }
        return isMasked ? .preserveMasked : .reject
    }

    static func isMasked(isSecure: Bool, value: Any?, placeholder: String?) -> Bool {
        guard isSecure, let text = value as? String, !text.isEmpty, text != placeholder else { return false }
        return text.allSatisfy { "•●*".contains($0) }
    }
}
