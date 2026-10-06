// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MortalMahjong",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "MortalMahjong",
            path: "Sources/MortalMahjong"
        )
    ]
)
