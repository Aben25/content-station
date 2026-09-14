import SwiftUI

/// Design tokens for the wall app. Values come from the design files.
enum Theme {
    static let black = Color.black
    static let amber = Color(red: 224 / 255, green: 138 / 255, blue: 46 / 255)
    static let text = Color(red: 242 / 255, green: 239 / 255, blue: 233 / 255)
    static let tertiary = Color(red: 184 / 255, green: 179 / 255, blue: 170 / 255)
    static let track = Color(red: 42 / 255, green: 41 / 255, blue: 38 / 255)
    static let dashed = Color(red: 142 / 255, green: 138 / 255, blue: 130 / 255)
    static let stripeLight = Color(red: 26 / 255, green: 25 / 255, blue: 23 / 255)
    static let stripeDark = Color(red: 21 / 255, green: 20 / 255, blue: 18 / 255)

    /// Design frame the wall layouts were drawn on.
    static let designWidth: CGFloat = 390
    static let designHeight: CGFloat = 844

    static let lineOneSize: CGFloat = 44
    static let lineTwoSize: CGFloat = 28
    static let codeSize: CGFloat = 112
    static let glyphSize: CGFloat = 120
    static let glyphTextGap: CGFloat = 44
    static let lineGap: CGFloat = 18
    static let horizontalPadding: CGFloat = 32
}
