export interface VoiceSendResult { id?: string; error?: string; deliveryUnknown?: boolean }
export interface VoiceDelivery {
  synthesize(): Promise<{ url: string } | null>;
  sendAudio(url: string): Promise<VoiceSendResult>;
  sendText(): Promise<VoiceSendResult>;
}

/** Preserve actionable links and the complete answer when voice is unsuitable.
 * Only an explicit media rejection permits another send. A thrown transport
 * error has unknown delivery status, so retrying as text could duplicate it.
 */
export async function deliverVoiceReply(text: string, enabled: boolean, delivery: VoiceDelivery): Promise<VoiceSendResult> {
  if (enabled && !/https?:\/\//i.test(text)) {
    const audio = await delivery.synthesize();
    if (audio) {
      const sent = await delivery.sendAudio(audio.url);
      if (sent.id || !sent.error || sent.deliveryUnknown) return sent;
    }
  }
  return delivery.sendText();
}
