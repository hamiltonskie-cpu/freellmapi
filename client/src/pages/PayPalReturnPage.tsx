import { useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, CreditCard, LoaderCircle } from 'lucide-react'
import { apiFetch } from '@/lib/api'

function PayPalReturnPage() {
  const [params] = useSearchParams()
  const workspaceId = Number(params.get('workspaceId'))
  const intentId = Number(params.get('intentId'))
  const valid = Number.isSafeInteger(workspaceId) && workspaceId > 0 && Number.isSafeInteger(intentId) && intentId > 0
  const capture = useMutation({
    mutationFn: () => apiFetch<{ status: string; ledgerStatus: string }>(`/api/billing/intents/${workspaceId}/${intentId}/paypal-capture`, { method: 'POST' }),
  })

  return <main className="flex min-h-dvh items-center justify-center bg-[#f7f8f6] px-4 py-10 text-[#1d2c2a]"><section className="w-full max-w-md rounded-2xl border border-[#e4e9e5] bg-white p-7 text-center shadow-sm"><span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[#d9f3e8] text-[#287b5b]"><CreditCard size={22} /></span><h1 className="mt-5 text-xl font-semibold">Finish PayPal checkout</h1><p className="mt-2 text-sm leading-6 text-[#74827e]">Confirm the approved PayPal order. Credits appear only after PayPal confirms capture to our verified webhook.</p>{capture.data ? <p className="mt-5 flex items-center justify-center gap-2 rounded-lg bg-[#f0f8f3] px-3 py-3 text-sm text-[#287b5b]"><CheckCircle2 size={17} />{capture.data.ledgerStatus === 'settled' ? 'Payment is settled.' : 'Capture requested. Waiting for PayPal confirmation.'}</p> : <button type="button" disabled={!valid || capture.isPending} onClick={() => capture.mutate()} className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#287b5b] px-5 text-sm font-semibold text-white disabled:opacity-50">{capture.isPending && <LoaderCircle className="animate-spin" size={16} />}Capture PayPal payment</button>}{capture.isError && <p role="alert" className="mt-4 text-sm text-[#a64d39]">{capture.error.message}</p>}{!valid && <p role="alert" className="mt-4 text-sm text-[#a64d39]">This payment return link is incomplete. Go back to billing and restart checkout.</p>}<p className="mt-5 text-xs text-[#9aa59f]">Do not close this page until PayPal redirects back. If confirmation takes a moment, check the workspace balance shortly.</p></section></main>
}

export default PayPalReturnPage