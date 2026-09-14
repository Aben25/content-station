import Foundation

func check(_ condition: @autoclosure () -> Bool, _ name: String) {
    if !condition() { fatalError("FAILED: \(name)") }
    print("PASS: \(name)")
}
let first = try JSONDecoder().decode(DeviceConfig.self, from: Data(#"{"reference_frame_url":"https://example.com/a?token=1","reference_frame_revision":"saved-1"}"#.utf8))
let rotated = try JSONDecoder().decode(DeviceConfig.self, from: Data(#"{"reference_frame_url":"https://example.com/a?token=2","reference_frame_revision":"saved-1"}"#.utf8))
let saved = try JSONDecoder().decode(DeviceConfig.self, from: Data(#"{"reference_frame_url":"https://example.com/a?token=3","reference_frame_revision":"saved-2"}"#.utf8))
check(!rotated.hasNewReference(comparedTo: first.referenceFrameRevision), "URL renewal preserves drift and framing")
check(saved.hasNewReference(comparedTo: first.referenceFrameRevision), "saved revision resets drift and ends framing")
let legacy = try JSONDecoder().decode(DeviceConfig.self, from: Data(#"{"reference_frame_url":"https://example.com/a?token=4"}"#.utf8))
check(!legacy.hasNewReference(comparedTo: nil), "legacy config cannot imply a new save")
check(UploadAuthorization.permits(origin: "a", active: "a", token: "jwt"), "same pairing restart recovers")
check(!UploadAuthorization.permits(origin: "a", active: "b", token: "new-jwt"), "different pairing quarantines")
check(!UploadAuthorization.permits(origin: nil, active: "b", token: "jwt"), "legacy footage quarantines")
check(!UploadAuthorization.permits(origin: "a", active: "a", token: nil), "missing token blocks upload")
check(!UploadAuthorization.permits(origin: "a", active: nil, token: "jwt"), "unpair blocks upload")
MainActor.assumeIsolated {
    let machine = StateMachine(isPaired: true, shortCode: "TEST")
    let now = Date()
    machine.now = { now }
    var framing = first
    framing.framingUntil = TimeFormat.iso8601(now.addingTimeInterval(60))
    machine.config = framing
    machine.driftDetected = true
    check(machine.isFramingActive, "framing window starts")
    framing.referenceFrameUrl = rotated.referenceFrameUrl
    machine.config = framing
    check(machine.isFramingActive && machine.driftDetected, "poll URL rotation preserves active framing and drift")
    framing.referenceFrameRevision = saved.referenceFrameRevision
    machine.config = framing
    check(!machine.isFramingActive, "saved reference ends active framing")
}
var generation = CaptureGeneration()
let previousFrame = generation.current
check(generation.accepts(previousFrame), "current encoder callback accepted")
generation.advance()
check(!generation.accepts(previousFrame), "late old-pairing callback rejected after switch")
let newFrame = generation.current
check(generation.accepts(newFrame), "new-pairing callback accepted")
generation.advance()
check(!generation.accepts(newFrame) && !generation.accepts(previousFrame), "unpair or encoder rebuild invalidates outstanding callbacks")
