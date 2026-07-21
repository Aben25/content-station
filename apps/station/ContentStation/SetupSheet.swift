import SwiftUI

/// Pairing screen. Shows the code the owner types into the dashboard, and
/// polls until they approve. No URLs, no tokens, nothing for staff to type.
struct SetupSheet: View {
    @EnvironmentObject var station: StationConfig
    @Environment(\.dismiss) private var dismiss

    @State private var polling = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                if station.approved {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(.green)
                    Text("Station paired")
                        .font(.title2.bold())
                    Text("Captures will upload automatically.")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Pair this station")
                        .font(.title2.bold())
                    Text("Enter this code in the Content Station dashboard.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)

                    Text(station.pairingCode ?? "……")
                        .font(.system(size: 48, weight: .bold, design: .monospaced))
                        .tracking(8)
                        .padding(.vertical, 16)
                        .padding(.horizontal, 24)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))

                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Waiting for approval…")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if let error = station.lastError {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                Spacer()
            }
            .padding(32)
            .navigationTitle("Setup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .disabled(!station.approved)
                }
            }
            .task {
                polling = true
                await station.registerAndRefresh()
                // Poll rather than stream: one document, checked every few
                // seconds, only while this screen is open.
                while polling && !station.approved {
                    try? await Task.sleep(for: .seconds(4))
                    await station.registerAndRefresh()
                }
            }
            .onDisappear { polling = false }
        }
    }
}
