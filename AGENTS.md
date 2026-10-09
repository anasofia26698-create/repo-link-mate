<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- The Purchases Dashboard combines persisted buyer budgets with imported principal cash-flow totals for its KPIs and imported buyer payments for buyer breakdowns/charts, never browser-local data, so every user sees the same consolidated figures.
- October accounting is stored in purchase_month_accounting and updated atomically by a service-only RPC on principal imports; remaining-debit sheets derive paid as preserved total minus open, so buyer confirmations never masquerade as payments and all viewers share a nondecreasing total.
