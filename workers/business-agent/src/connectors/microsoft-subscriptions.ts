import { ProviderHTTP, segment, singleLine } from "./http";
import { ConnectorError, type ClientOptions, type ConnectorAuth, type Operation, type WatchReceipt } from "./types";
import { GRAPH_BASE } from "./microsoft-calendar";
export type SubscriptionResource = "mail" | "calendar";
const operation = (resource: SubscriptionResource): Operation => ({ name: `microsoft.${resource}.subscription`, effect: "write", scopes: [resource === "mail" ? ["Mail.Read", "Mail.ReadWrite"] : ["Calendars.Read", "Calendars.ReadWrite"]] });
function expiry(value: string) {
  const expires = Date.parse(value);
  // Outlook subscriptions without resource data last at most 10,080 minutes.
  if (!Number.isFinite(expires) || expires <= Date.now() || expires - Date.now() > 10080 * 60_000) throw new ConnectorError("invalid_input", "subscription_expiry");
  return new Date(expires).toISOString();
}
export class MicrosoftSubscriptionClient {
  private readonly http: ProviderHTTP;
  constructor(auth: ConnectorAuth, options?: ClientOptions) { this.http = new ProviderHTTP(auth, GRAPH_BASE, options); }
  async create(resource: SubscriptionResource, input: { notificationURL: string; lifecycleURL: string; clientState: string; expiresAt: string }): Promise<WatchReceipt> {
    for (const value of [input.notificationURL, input.lifecycleURL]) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new ConnectorError("invalid_input", "subscription_webhook");
    }
    singleLine(input.clientState, "subscription_client_state", 128);
    const data = await this.http.request<{ id: string; expirationDateTime: string }>(operation(resource), "subscriptions", {
      method: "POST", body: { changeType: "created,updated,deleted", resource: resource === "mail" ? "me/messages" : "me/events", notificationUrl: input.notificationURL, lifecycleNotificationUrl: input.lifecycleURL, clientState: input.clientState, expirationDateTime: expiry(input.expiresAt) },
    });
    return { id: data.id, expiresAt: data.expirationDateTime };
  }
  async renew(resource: SubscriptionResource, subscriptionId: string, expiresAt: string): Promise<WatchReceipt> {
    const data = await this.http.request<{ id: string; expirationDateTime: string }>(operation(resource), `subscriptions/${segment(subscriptionId)}`, { method: "PATCH", body: { expirationDateTime: expiry(expiresAt) } });
    return { id: data.id, expiresAt: data.expirationDateTime };
  }
  async stop(resource: SubscriptionResource, subscriptionId: string): Promise<void> { await this.http.request(operation(resource), `subscriptions/${segment(subscriptionId)}`, { method: "DELETE" }); }
}
