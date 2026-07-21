import SwiftUI

/// One-time station setup: backend URL + station token. Shown automatically
/// until the station is configured, and reachable afterwards from the footer.
struct SetupSheet: View {
    @EnvironmentObject var config: StationConfig
    @Environment(\.dismiss) private var dismiss

    @State private var urlString: String = ""
    @State private var token: String = ""
    @State private var invalid = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Backend") {
                    TextField("https://api.example.com", text: $urlString)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                }
                Section("Station token") {
                    SecureField("cs_stn_…", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                if invalid {
                    Text("Needs an https:// URL and a non-empty token.")
                        .foregroundStyle(.red)
                        .font(.footnote)
                }
                if config.isConfigured {
                    Section {
                        Button("Forget this station", role: .destructive) {
                            config.clear()
                            urlString = ""
                            token = ""
                        }
                    }
                }
            }
            .navigationTitle("Station Setup")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if config.save(urlString: urlString, token: token) {
                            dismiss()
                        } else {
                            invalid = true
                        }
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(!config.isConfigured)
                }
            }
            .onAppear {
                urlString = config.baseURL?.absoluteString ?? ""
            }
        }
    }
}
