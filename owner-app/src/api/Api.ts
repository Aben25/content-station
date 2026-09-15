import type {
  CameraStatus,
  Clip,
  ClipEventType,
  ClipsResponse,
  FramingStart,
  HoursSuggestion,
  Me,
  PairStatus,
  PairToken,
  PauseUntil,
  Preview,
  Publication,
  PublishInput,
  PublishingOverview,
  ReferenceFrame,
  Session,
  Shop,
  ShopInput,
  ShopPatch,
  ShopType,
} from './types';

export interface Api {
  sendOtp(phone: string): Promise<void>;
  verifyOtp(phone: string, code: string): Promise<Session>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
  me(): Promise<Me>;
  createShop(input: ShopInput): Promise<Shop>;
  updateShop(patch: ShopPatch): Promise<Shop>;
  createPairToken(ssid: string, password: string): Promise<PairToken>;
  pairStatus(token: string): Promise<PairStatus>;
  cameraStatus(): Promise<CameraStatus>;
  pause(until: PauseUntil): Promise<CameraStatus>;
  resume(): Promise<CameraStatus>;
  framingStart(): Promise<FramingStart>;
  preview(): Promise<Preview | null>;
  saveReferenceFrame(): Promise<ReferenceFrame>;
  unpair(): Promise<void>;
  clips(date?: string): Promise<ClipsResponse>;
  clip(id: string): Promise<Clip>;
  updateCaption(id: string, caption: string): Promise<Clip>;
  clipEvent(id: string, type: ClipEventType, reason?: string): Promise<Clip>;
  deleteClip(id: string): Promise<void>;
  suggestHours(name: string, type: ShopType): Promise<HoursSuggestion>;
  // Publishing. Every call is scoped to the signed-in owner's shop on the server.
  publishingAccounts(): Promise<PublishingOverview>;
  connectAccount(provider: string): Promise<{ url: string; provider: string }>;
  reconnectAccount(id: string, provider: string): Promise<{ url: string; provider: string }>;
  disconnectAccount(id: string): Promise<void>;
  publishClip(id: string, input: PublishInput): Promise<Publication>;
  clipPublications(id: string): Promise<Publication[]>;
  publication(id: string): Promise<Publication>;
  cancelPublication(id: string): Promise<Publication>;
}
