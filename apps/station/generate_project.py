#!/usr/bin/env python3
"""Generate a minimal, valid .xcodeproj for the ContentStation iOS app."""
import os, random, plistlib

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(ROOT, "ContentStation")
SWIFT_FILES = sorted(f for f in os.listdir(SRC_DIR) if f.endswith(".swift"))

def gid():
    return "".join(random.choices("0123456789ABCDEF", k=24))

IDS = {
    "project": gid(), "target": gid(), "products_group": gid(),
    "main_group": gid(), "src_group": gid(),
    "sources_phase": gid(), "frameworks_phase": gid(), "resources_phase": gid(),
    "app_ref": gid(),
    "config_list_proj": gid(), "config_list_target": gid(),
    "debug_proj": gid(), "release_proj": gid(),
    "debug_target": gid(), "release_target": gid(),
    "info_plist_ref": gid(),
}
for f in SWIFT_FILES:
    IDS[f"fileref_{f}"] = gid()
    IDS[f"buildfile_{f}"] = gid()
IDS["assets_ref"] = gid()
IDS["assets_buildfile"] = gid()

# Baked station credentials. Gitignored, so a fresh clone simply builds without
# them and the app reports that it needs provisioning.
HAS_CREDENTIALS = os.path.exists(os.path.join(SRC_DIR, "StationCredentials.plist"))
if HAS_CREDENTIALS:
    IDS["creds_ref"] = gid()
    IDS["creds_buildfile"] = gid()

objects = {}

objects[IDS["project"]] = {
    "isa": "PBXProject",
    "attributes": {"LastUpgradeCheck": "2600", "TargetAttributes": {IDS["target"]: {"CreatedOnToolsVersion": "26.0"}}},
    "buildConfigurationList": IDS["config_list_proj"],
    "compatibilityVersion": "Xcode 15.0",
    "developmentRegion": "en",
    "hasScannedForEncodings": 0,
    "knownRegions": ["en", "Base"],
    "mainGroup": IDS["main_group"],
    "productRefGroup": IDS["products_group"],
    "projectDirPath": "",
    "projectRoot": "",
    "targets": [IDS["target"]],
}

children = [IDS[f"fileref_{f}"] for f in SWIFT_FILES] + [IDS["info_plist_ref"], IDS["assets_ref"]]
if HAS_CREDENTIALS:
    children.append(IDS["creds_ref"])
objects[IDS["src_group"]] = {
    "isa": "PBXGroup", "children": children, "path": "ContentStation", "sourceTree": "<group>",
}
objects[IDS["main_group"]] = {
    "isa": "PBXGroup", "children": [IDS["src_group"], IDS["products_group"]], "sourceTree": "<group>",
}
objects[IDS["products_group"]] = {
    "isa": "PBXGroup", "children": [IDS["app_ref"]], "name": "Products", "sourceTree": "<group>",
}

objects[IDS["app_ref"]] = {
    "isa": "PBXFileReference", "explicitFileType": "wrapper.application",
    "includeInIndex": 0, "path": "ContentStation.app", "sourceTree": "BUILT_PRODUCTS_DIR",
}
objects[IDS["info_plist_ref"]] = {
    "isa": "PBXFileReference", "lastKnownFileType": "text.plist.xml",
    "path": "Info.plist", "sourceTree": "<group>",
}
for f in SWIFT_FILES:
    objects[IDS[f"fileref_{f}"]] = {
        "isa": "PBXFileReference", "lastKnownFileType": "sourcecode.swift",
        "path": f, "sourceTree": "<group>",
    }
    objects[IDS[f"buildfile_{f}"]] = {
        "isa": "PBXBuildFile", "fileRef": IDS[f"fileref_{f}"],
    }

objects[IDS["assets_ref"]] = {
    "isa": "PBXFileReference", "lastKnownFileType": "folder.assetcatalog",
    "path": "Assets.xcassets", "sourceTree": "<group>",
}
objects[IDS["assets_buildfile"]] = {
    "isa": "PBXBuildFile", "fileRef": IDS["assets_ref"],
}
if HAS_CREDENTIALS:
    objects[IDS["creds_ref"]] = {
        "isa": "PBXFileReference", "lastKnownFileType": "text.plist.xml",
        "path": "StationCredentials.plist", "sourceTree": "<group>",
    }
    objects[IDS["creds_buildfile"]] = {
        "isa": "PBXBuildFile", "fileRef": IDS["creds_ref"],
    }
objects[IDS["sources_phase"]] = {
    "isa": "PBXSourcesBuildPhase", "buildActionMask": 2147483647,
    "files": [IDS[f"buildfile_{f}"] for f in SWIFT_FILES], "runOnlyForDeploymentPostprocessing": 0,
}
objects[IDS["frameworks_phase"]] = {
    "isa": "PBXFrameworksBuildPhase", "buildActionMask": 2147483647, "files": [],
    "runOnlyForDeploymentPostprocessing": 0,
}
objects[IDS["resources_phase"]] = {
    "isa": "PBXResourcesBuildPhase", "buildActionMask": 2147483647,
    "files": [IDS["assets_buildfile"]] + ([IDS["creds_buildfile"]] if HAS_CREDENTIALS else []),
    "runOnlyForDeploymentPostprocessing": 0,
}

objects[IDS["target"]] = {
    "isa": "PBXNativeTarget",
    "buildConfigurationList": IDS["config_list_target"],
    "buildPhases": [IDS["sources_phase"], IDS["frameworks_phase"], IDS["resources_phase"]],
    "buildRules": [], "dependencies": [],
    "name": "ContentStation", "productName": "ContentStation",
    "productReference": IDS["app_ref"], "productType": "com.apple.product-type.application",
}

base_proj = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "CLANG_ANALYZER_NONNULL": "YES",
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "COPY_PHASE_STRIP": "NO",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES",
    "GCC_C_LANGUAGE_STANDARD": "gnu17",
    "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
    "SDKROOT": "iphoneos",
    "SWIFT_VERSION": "5.0",
}
objects[IDS["debug_proj"]] = {
    "isa": "XCBuildConfiguration", "name": "Debug",
    "buildSettings": {**base_proj, "DEBUG_INFORMATION_FORMAT": "dwarf", "ENABLE_TESTABILITY": "YES", "ONLY_ACTIVE_ARCH": "YES"},
}
objects[IDS["release_proj"]] = {
    "isa": "XCBuildConfiguration", "name": "Release",
    "buildSettings": {**base_proj, "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym", "VALIDATE_PRODUCT": "YES"},
}

base_target = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "DEVELOPMENT_TEAM": "HP284BJ924",
    "GENERATE_INFOPLIST_FILE": "NO",
    "INFOPLIST_FILE": "ContentStation/Info.plist",
    "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
    "MARKETING_VERSION": "0.1.0",
    "PRODUCT_BUNDLE_IDENTIFIER": "com.contentstation.station",
    "PRODUCT_NAME": "$(TARGET_NAME)",
    "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
    "SUPPORTS_MACCATALYST": "NO",
    "SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD": "NO",
    "SWIFT_EMIT_LOC_STRINGS": "YES",
    "SWIFT_VERSION": "5.0",
    "TARGETED_DEVICE_FAMILY": "1",
}
objects[IDS["debug_target"]] = {
    "isa": "XCBuildConfiguration", "name": "Debug",
    "buildSettings": {**base_target, "SWIFT_OPTIMIZATION_LEVEL": "-Onone"},
}
objects[IDS["release_target"]] = {
    "isa": "XCBuildConfiguration", "name": "Release",
    "buildSettings": {**base_target, "SWIFT_COMPILATION_MODE": "wholemodule"},
}

objects[IDS["config_list_proj"]] = {
    "isa": "XCConfigurationList",
    "buildConfigurations": [IDS["debug_proj"], IDS["release_proj"]],
    "defaultConfigurationIsVisible": 0, "defaultConfigurationName": "Release",
}
objects[IDS["config_list_target"]] = {
    "isa": "XCConfigurationList",
    "buildConfigurations": [IDS["debug_target"], IDS["release_target"]],
    "defaultConfigurationIsVisible": 0, "defaultConfigurationName": "Release",
}

project = {"archiveVersion": "1", "classes": {}, "objectVersion": "56",
           "objects": objects, "rootObject": IDS["project"]}

proj_dir = os.path.join(ROOT, "ContentStation.xcodeproj")
os.makedirs(proj_dir, exist_ok=True)
with open(os.path.join(proj_dir, "project.pbxproj"), "wb") as fh:
    plistlib.dump(project, fh, fmt=plistlib.FMT_XML)

suffix = " + baked credentials" if HAS_CREDENTIALS else " (no StationCredentials.plist — app will need provisioning)"
print(f"Generated {proj_dir} with {len(SWIFT_FILES)} Swift files{suffix}")
