"""Ready-made instructions the user can add with one tap (GET /instructions/templates),
for the calls an owner in India gets every day. Written as the user would write
them; ``applies_to`` is who they are for (see models.Instruction). Categories are
short slugs the app shows as headings."""

from __future__ import annotations

TEMPLATES: list[dict[str, str]] = [
    # Delivery partners: getting to the door, and OTPs at the door.
    {"category": "delivery", "applies_to": "delivery",
     "text": "Ask delivery partners to leave parcels with the security guard at the gate and say which flat it's for."},
    {"category": "delivery", "applies_to": "delivery",
     "text": "For food orders (Swiggy, Zomato), ask them to come up to the door. Give the landmark first, then the"
             " floor and flat number."},
    {"category": "delivery", "applies_to": "delivery",
     "text": "If a delivery needs an OTP, say I'll tell it to them at the door. Never read out an OTP on the phone."},
    {"category": "delivery", "applies_to": "delivery",
     "text": "If nobody opens the door, ask them to leave it with the neighbour opposite, not outside the door."},
    {"category": "delivery", "applies_to": "delivery",
     "text": "If a courier needs a signature or ID, ask them to come back after 6 PM or on Saturday."},
    {"category": "delivery", "applies_to": "delivery",
     "text": "Ask delivery partners not to ring the bell after 10 PM; they should call again from the gate instead."},
    {"category": "delivery", "applies_to": "delivery",
     "text": "If they can't find the building, describe the gate and offer to send the map link."},
    # Banks, OTPs and KYC: the scams that cost people money.
    {"category": "security", "applies_to": "everyone",
     "text": "If someone says they're from a bank, RBI, a card company or about a 'KYC update', share nothing. Say"
             " I'll call the bank myself on the number on my card."},
    {"category": "security", "applies_to": "everyone",
     "text": "If a caller says my account, card, SIM or electricity will be blocked today, treat it as a scam: end"
             " the call politely and tell me."},
    {"category": "security", "applies_to": "unknown",
     "text": "Never confirm my date of birth, Aadhaar, PAN or address to unknown callers, even if they already know"
             " part of it."},
    {"category": "security", "applies_to": "unknown",
     "text": "If someone claims to be police, customs or a courier with a 'seized parcel', don't argue: take their"
             " name and number and say I'll call back."},
    {"category": "security", "applies_to": "everyone",
     "text": "If a caller asks me to install an app like AnyDesk or TeamViewer or to share my screen, refuse and end"
             " the call."},
    # Family, friends and the people who matter most.
    {"category": "family", "applies_to": "contacts",
     "text": "If family calls, tell them I'll call back within the hour and ask whether it's urgent."},
    {"category": "family", "applies_to": "contacts",
     "text": "If my parents say it's urgent, put the call on hold and ask me right away."},
    {"category": "family", "applies_to": "contacts",
     "text": "Saved contacts may be told roughly when I'll be free."},
    # Work.
    {"category": "work", "applies_to": "unknown",
     "text": "For work calls, ask for their name, company and what it's about, and whether it can wait until"
             " tomorrow."},
    {"category": "work", "applies_to": "contacts",
     "text": "Tell colleagues I check messages at 1 PM and 6 PM, and take a detailed message."},
    {"category": "work", "applies_to": "everyone",
     "text": "If a client asks to fix a meeting time, don't agree to one; say I'll confirm by message."},
    # Doctors, clinics, labs and pharmacies.
    {"category": "health", "applies_to": "everyone",
     "text": "If a clinic or hospital calls, note the exact appointment time, the doctor's name and anything I need"
             " to bring."},
    {"category": "health", "applies_to": "unknown",
     "text": "If a lab calls about test results, don't discuss them on the phone; ask them to send the report on"
             " WhatsApp or by email."},
    {"category": "health", "applies_to": "unknown",
     "text": "If a pharmacy calls about my order, ask when it will arrive and how much I need to pay."},
    # Home: landlord, society office, couriers, repairs and services.
    {"category": "home", "applies_to": "contacts",
     "text": "If my landlord or the society office calls, take a detailed message and say I'll call back today."},
    {"category": "home", "applies_to": "everyone",
     "text": "For the maid, cook, plumber or electrician, ask what time they're coming and ask them to come after"
             " 10 AM."},
    {"category": "home", "applies_to": "everyone",
     "text": "If the gas, electricity or internet company calls about a visit, note the date, time and booking"
             " number."},
    {"category": "home", "applies_to": "everyone",
     "text": "If a courier company calls to reschedule, choose the next weekday evening and note the tracking"
             " number."},
    # Unknown numbers.
    {"category": "unknown", "applies_to": "unknown",
     "text": "Ask unknown callers for their name and the reason for the call before anything else."},
    {"category": "unknown", "applies_to": "unknown",
     "text": "Don't tell unknown callers whether I'm at home, travelling or alone."},
    {"category": "unknown", "applies_to": "unknown",
     "text": "If an unknown caller won't say who they are, end the call politely."},
    # Sales, loans, cards, insurance and real-estate cold calls.
    {"category": "sales", "applies_to": "unknown",
     "text": "I'm not interested in loans, credit cards, insurance or investment plans: decline politely and end"
             " the call."},
    {"category": "sales", "applies_to": "unknown",
     "text": "For real-estate calls about plots, flats or villas, say I'm not looking and ask them to remove my"
             " number."},
    {"category": "sales", "applies_to": "unknown",
     "text": "End surveys, lucky draws and 'you have won a prize' calls without taking a message."},
    {"category": "sales", "applies_to": "unknown",
     "text": "If a caller offers a free upgrade or plan from my mobile network, decline; I'll go to the store"
             " myself."},
    # Away modes: meeting, driving, sleeping.
    {"category": "availability", "applies_to": "everyone",
     "text": "When I'm in a meeting, take messages and only put urgent calls on hold."},
    {"category": "availability", "applies_to": "everyone",
     "text": "When I'm driving, tell callers I'll call back once I've stopped, in about 30 minutes."},
    {"category": "availability", "applies_to": "everyone",
     "text": "When I'm sleeping, don't put anyone on hold; take messages unless family says it's urgent."},
    {"category": "availability", "applies_to": "unknown",
     "text": "On Sundays, tell work callers I'll get back to them on Monday."},
    # Callback promises.
    {"category": "callbacks", "applies_to": "everyone",
     "text": "Never promise a call back at an exact time; say I'll call back as soon as I can today."},
    {"category": "callbacks", "applies_to": "everyone",
     "text": "When someone wants a call back, ask for the best time and number to reach them."},
    {"category": "callbacks", "applies_to": "contacts",
     "text": "Tell saved contacts I'll call them back the same day."},
]
