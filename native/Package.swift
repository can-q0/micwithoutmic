// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SignalCore",
    platforms: [.macOS(.v13)],
    products: [.library(name: "SignalCore", targets: ["SignalCore"])],
    targets: [
        .target(name: "SignalCore"),
        .testTarget(name: "SignalCoreTests", dependencies: ["SignalCore"])
    ]
)
