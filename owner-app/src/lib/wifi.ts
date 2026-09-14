import { isMock } from '../api/index';
import { mockNetworkName } from '../api/mock';

// There is no web API that exposes the phone's Wi-Fi SSID. Best effort only:
// the mock supplies the prototype's network name, the real app starts empty.
export function knownNetworkName(): string | null {
  if (isMock) return mockNetworkName();
  return null;
}
