// swift-tools-version: 6.0
import PackageDescription

// CinemaCore is pure Swift (Foundation + Observation) and builds and tests on
// Linux and macOS as well as iOS. The SwiftUI modules are Apple-platform only.

var targets: [Target] = [
    .target(
        name: "CinemaCore",
        resources: [.copy("PreviewData")],
        swiftSettings: [.enableUpcomingFeature("ExistentialAny")]
    ),
    .testTarget(
        name: "CinemaCoreTests",
        dependencies: ["CinemaCore"]
    ),
]

var products: [Product] = [
    .library(name: "CinemaCore", targets: ["CinemaCore"]),
]

#if !os(Linux)
targets += [
    .target(name: "CinemaDesign", dependencies: ["CinemaCore"], swiftSettings: [.swiftLanguageMode(.v5)]),
    .target(name: "CinemaSeatMap", dependencies: ["CinemaCore", "CinemaDesign"], swiftSettings: [.swiftLanguageMode(.v5)]),
    .target(name: "CinemaFeatures", dependencies: ["CinemaCore", "CinemaDesign", "CinemaSeatMap"], swiftSettings: [.swiftLanguageMode(.v5)]),
]
products += [
    .library(name: "CinemaFeatures", targets: ["CinemaFeatures"]),
]
#endif

let package = Package(
    name: "CinemaKit",
    defaultLocalization: "en",
    platforms: [.iOS("27.0"), .macOS("15.0")],
    products: products,
    targets: targets
)
