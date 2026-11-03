import type { CurrencyCode } from '@/features/policy/config'

/**
 * Provider-facing vocabulary for the intended booking and payout flow.
 *
 * The model requests the full guest total at booking and a separate host-share
 * approval after the dinner. The interface and its local tests do not establish
 * live provider behavior, settlement guarantees, or legal compliance. See the
 * payment integration boundary in docs/ARCHITECTURE.md.
 */
export type PaymentStatus =
  'created' | 'authorized' | 'failed' | 'refunded' | 'held'

/**
 * The cardholder as the provider needs to know them. This is the traveller's
 * own identity going to their own payment processor — never the host, never
 * the venue. The payload builder supplies a neutral platform address; the
 * dinner address must not appear here or anywhere downstream of here.
 */
export interface CheckoutBuyer {
  id: string
  name: string
  surname: string
  email: string
  ip: string
}

export interface CreateCheckoutInput {
  bookingId: string
  /** Full guest total — charged at booking, in one payment. */
  amountKurus: number
  /** The host's named net; becomes subMerchantPrice, paid through untouched. */
  hostNetPayoutKurus: number
  /**
   * The provider's sub-merchant key for the host. Null is tolerated only by
   * the mock; the real adapter refuses it because a marketplace charge cannot
   * exist without a registered payee.
   */
  hostPayeeReference: string | null
  currency: CurrencyCode
  buyer: CheckoutBuyer
  /** Where the hosted payment page returns the traveller afterwards. */
  callbackUrl: string
  /** Mock-only lever for deterministic tests; the real adapter ignores it. */
  deterministicOutcome?: 'success' | 'failure'
}

export interface CreateCheckoutResult {
  /** The provider handle for this payment attempt (checkout token). */
  reference: string
  /** Hosted payment page to send the traveller to; null for the mock. */
  checkoutUrl: string | null
  status: PaymentStatus
  auditId: string
}

/**
 * The settled state of a checkout, read back from the provider after the
 * traveller returns (and again on webhook). `providerItemReference` is the
 * per-item paymentTransactionId — the handle every later approve, disapprove,
 * and refund is scoped to.
 */
export interface CheckoutStatusResult {
  status: PaymentStatus
  providerPaymentId: string | null
  providerItemReference: string | null
  paidAmountKurus: number | null
  /**
   * What the provider will actually pay the host. The caller must reject the
   * payment if this differs from the booking's host_net_payout_kurus: the
   * money model's premise is that the host receives exactly what they named.
   */
  hostPayoutAmountKurus: number | null
}

export interface RefundPaymentInput {
  /** paymentTransactionId — refunds are scoped to one host's leg. */
  providerItemReference: string
  amountKurus: number
  reason: string
}

export interface RefundPaymentResult {
  reference: string
  status: 'refunded'
  auditId: string
}

/**
 * Input for host registration as a provider sub-merchant (PERSONAL).
 * Identity number, IBAN, and the payee's own address are private KYC payloads;
 * do not log them. Live onboarding and provider acceptance remain unverified.
 */
export interface RegisterHostPayeeInput {
  hostId: string
  contactName: string
  contactSurname: string
  email: string
  gsmNumber: string
  identityNumber: string
  iban: string
  address: string
}

export interface RegisterHostPayeeResult {
  /** The provider's subMerchantKey; stored, and required by every checkout. */
  payeeReference: string
  status: 'registered' | 'development_only'
}

export interface ReleaseHostPayoutInput {
  payoutId: string
  providerItemReference: string
  /** The host net this release is expected to pay; asserted, not trusted. */
  amountKurus: number
  /** An open safety hold blocks release; the database enforces it too. */
  held: boolean
}

export interface ReleaseHostPayoutResult {
  payoutId: string
  status: 'released' | 'held'
  auditId: string
}

export interface RevokeHostPayoutInput {
  payoutId: string
  providerItemReference: string
  reason: string
}

export interface RevokeHostPayoutResult {
  payoutId: string
  status: 'revoked'
  auditId: string
}

/**
 * Requests an adjustment to the host's share on a provider item. Permitted
 * timing and behavior, including restrictions after payout approval, must be
 * verified with the provider before live use.
 */
export interface UpdateHostShareInput {
  providerItemReference: string
  payeeReference: string
  hostNetKurus: number
}

export interface UpdateHostShareResult {
  providerItemReference: string
  status: 'updated'
}

export interface VerifyWebhookInput {
  body: string
  signature: string
}

export interface VerifiedPaymentEvent {
  /** Our conversation id — the booking-scoped reference we sent out. */
  reference: string
  providerPaymentId: string
  eventType: string
  status: PaymentStatus
}

export interface PaymentProvider {
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>
  getCheckoutStatus(reference: string): Promise<CheckoutStatusResult>
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>
  registerHostPayee(
    input: RegisterHostPayeeInput,
  ): Promise<RegisterHostPayeeResult>
  releaseHostPayout(
    input: ReleaseHostPayoutInput,
  ): Promise<ReleaseHostPayoutResult>
  revokeHostPayout(
    input: RevokeHostPayoutInput,
  ): Promise<RevokeHostPayoutResult>
  updateHostShare(input: UpdateHostShareInput): Promise<UpdateHostShareResult>
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedPaymentEvent>
}
