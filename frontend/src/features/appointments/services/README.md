# Bookable services

Rust management lives at `/appointments/services`; the Schedule Services tab
redirects there before unrelated scheduling queries mount. The legacy Django
form remains a separate lazy child. A role is not Rust service authority.

Ordinary pages require current AppointmentView, demographic permission and
visibility, and the Appointments feature. Changes require AppointmentManage,
current network write access and server-confirmed credentials. Original actor
receipts require current server proof too. Use central credential/factor
confirmation; never manufacture a passkey/Admin prerequisite or replay a change
automatically after confirmation.

The directory reads bounded 25-row cursor pages, including retired services.
Search text is hashed in query keys and authorization scope is opaque. Create
supports permanent code, name and integer default duration. Metadata correction
changes name and duration using a fresh exact version. Retirement stops new
booking references and can be refused by an active future-generating template;
reactivation restores availability for new bookings. Existing booked times and
history remain intact. No delete, code reuse, pricing or template mutation is
offered here.

Every write needs explicit review and a separate confirmation. Reviewed UUID/body
stays fixed in RAM during an unknown outcome. Ordinary close retains it; current
denial, scope change and pending authority loss invalidate copied proof. Only
the exact current actor's original typed receipt, canonical input digest and live
transport read lease can establish outcome. A separate acknowledgment removes
the opaque recovery barrier. A reload retains only a singleton opaque request
UUID, never a reconstructable command body. Ordinary catalog/detail reads do not
review an unknown write.

New booking checks the exact selected service independently of its bounded
active choice page. Retired or denied selections block single, waitlist and new
group publication, clear an invalid selected time and do not substitute another
service or remove an availability constraint. The calendar is not mounted until
the current selection is allowed. An already unknown group remains mounted for
original-result reconciliation after retirement. Single and waitlist forms have
no original UUID command interface in their existing contract; this module does
not invent one or claim that parity is complete. Existing booked-care detail,
arrival, cancellation and permitted rescheduling keep their separate workflows.

Historical snapshots retain exact stored code/name strings, including missing legacy values, and positive int32 durations. Display-only missing-value labels do not replace those values in reviewed evidence. New create/metadata inputs use the supported strict name/code/duration rules.
