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
- Cash-flow month availability reads persisted monthly plans, never audit constants; archived participation and buyer allocations are saved atomically so earlier months cannot change future plans.
- Purchase date, installment and availability validation is shared by the simulator and server; confirmations use a locked database transaction to validate aggregate day/month limits and write cash flow, buyer payments and audit together.
- Registered daily sales (daily_sales) replace the weekday average as the day-goal base in both simulationRules (setRegisteredDailySales) and the DB function flow_day_goal; keep them in sync so client and confirmation validation agree.
- Buyer goal months use shared period/allocation rules and a password-validated atomic save of the selected month's plan, buyer budgets, configurations and audit; unsaved edits require confirmation before switching months.
- Flow selection lists the entire shared month window and remembers only the display selection locally; purchasing eligibility still requires positive persisted plans and saved monthly sales, validated by the locked confirmation RPC.
- The flow selector filters only monthly financial views; initialize the editable simulator reference date from the device after hydration and never filter or reset its installments on month changes, so payment dates remain independent.
- Simulator confirmation controls select only approved installments and validate selected dates and budgets through shared rules; rejected scenarios remain visible without preventing confirmation of approved ones.
- Sector goals use password-validated TanStack server functions and an atomic database RPC; browser migration inserts missing records only and preserves existing monthly plans, so no browser can overwrite shared financial history during migration.
- Goals access credentials live only in mounted tab state and are verified server-side on entry, reads and writes; public financial views expose consolidated totals rather than protected goal records.
