"""Quality and speed check for translation, on sentences like the ones a receptionist
call actually has: the assistant's English replies said in Telugu, Tamil and Hindi,
and callers' lines in those languages read in English.

Reports, per language and direction, chrF against a reference (round trip for the
replies: English -> language -> English), whether every number and name survived,
and the time per sentence. Prints every translation for a human to read.

    python eval/mt_check.py --models ./data/models/mt --out mt_report.json
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from opencall.providers.mt import IndicTrans2  # noqa: E402

# What the assistant says (English, as the LLM writes it).
REPLIES = [
    "Hi, this is Ava, Rahul's assistant. Rahul can't take the call right now. How can I help?",
    "Please come to the green gate opposite Apollo Pharmacy.",
    "The flat is on the fourth floor, number 402.",
    "Please leave the parcel with the security guard.",
    "Rahul will be home after 6 PM.",
    "Can I take a message for him?",
    "Sorry, I can't share any codes or OTPs. I'll let Rahul know you called.",
    "One moment, please, let me check with Rahul.",
    "Thanks for waiting. Rahul says you can leave it at the door.",
    "Could you please tell me your name and why you're calling?",
    "I've sent the location to your phone by SMS.",
    "Please call again tomorrow morning.",
    "Rahul is in a meeting until 3 PM.",
    "Is this about the Amazon delivery?",
    "The building is called Sri Sai Nilayam, on Road No. 3, Banjara Hills.",
    "Please don't ring the bell, the baby is sleeping.",
    "Okay, I'll tell him. Thank you, bye!",
    "Sorry, could you say that again?",
    "Do you need directions to the house?",
    "Turn left after the temple and it's the third house on the right.",
    "Your payment can be collected when Rahul is back.",
    "Thanks, but we're not interested. Please remove this number from your list.",
    "Rahul asked me to say he will call you back in ten minutes.",
    "The gate code is not something I can share, but the guard will open it for you.",
    "Please wait near the lift, someone will come down.",
    "Is it okay if you deliver it tomorrow instead?",
    "Your Swiggy order can be left on the bench outside.",
    "I'm sorry, Rahul isn't available today.",
    "May I know which company you are calling from?",
    "Great, see you soon.",
]

# What callers say, with an English reference.
CALLERS = {
    "te": [
        ("హలో, స్విగ్గీ నుండి డెలివరీ వచ్చింది, ఎక్కడికి రావాలి?", "Hello, a delivery has come from Swiggy, where should I come?"),
        ("నేను గేటు దగ్గర ఉన్నాను, ఫ్లాట్ నంబర్ ఎంత?", "I am near the gate, what is the flat number?"),
        ("సార్ ఇంట్లో లేరా? నేను తర్వాత కాల్ చేస్తాను.", "Is sir not at home? I will call later."),
        ("పార్సెల్ సెక్యూరిటీ దగ్గర పెట్టమంటారా?", "Shall I leave the parcel with security?"),
        ("నాకు లొకేషన్ దొరకడం లేదు, కొంచెం చెప్తారా?", "I can't find the location, can you tell me a bit?"),
        ("ఐదు నిమిషాల్లో వస్తాను.", "I will come in five minutes."),
        ("క్యాష్ ఆన్ డెలివరీ, మూడు వందల రూపాయలు.", "Cash on delivery, three hundred rupees."),
        ("లిఫ్ట్ పని చేయడం లేదు, కిందికి రాగలరా?", "The lift is not working, can you come down?"),
        ("రాహుల్ గారితో మాట్లాడాలి, చాలా అర్జెంట్.", "I need to speak with Rahul, it is very urgent."),
        ("నేను బ్యాంక్ నుండి కాల్ చేస్తున్నాను.", "I am calling from the bank."),
        ("మీ ఓటీపీ చెప్పండి, ఆర్డర్ కన్ఫర్మ్ చేయాలి.", "Tell me your OTP, I have to confirm the order."),
        ("ఇల్లు ఏ వైపు ఉంటుంది, ఎడమా కుడా?", "Which side is the house, left or right?"),
        ("రేపు ఉదయం మళ్ళీ వస్తాను.", "I will come again tomorrow morning."),
        ("డోర్ దగ్గర పెట్టి వెళ్ళిపోనా?", "Shall I leave it at the door and go?"),
        ("సరే, థాంక్యూ అండి.", "Okay, thank you."),
        ("గుడి దగ్గర ఉన్నాను, ఇంకా ఎంత దూరం?", "I am near the temple, how much farther?"),
        ("అమెజాన్ పార్సెల్ ఉంది, సంతకం కావాలి.", "There is an Amazon parcel, a signature is needed."),
        ("మీ నంబర్ నాకు ఆర్డర్ లో వచ్చింది.", "I got your number in the order."),
        ("వర్షం పడుతోంది, కొంచెం లేట్ అవుతుంది.", "It is raining, it will be a little late."),
        ("అపార్ట్మెంట్ పేరు ఏమిటి?", "What is the apartment name?"),
    ],
    "hi": [
        ("भैया, आपका पार्सल आया है, गेट पर कौन लेगा?", "Brother, your parcel has come, who will take it at the gate?"),
        ("मैं पाँच मिनट में पहुँच जाऊँगा, लोकेशन भेज दीजिए।", "I will reach in five minutes, please send the location."),
        ("साहब घर पर नहीं हैं क्या?", "Is sir not at home?"),
        ("फ्लैट नंबर क्या है?", "What is the flat number?"),
        ("मैं बिल्डिंग के नीचे खड़ा हूँ।", "I am standing below the building."),
        ("कैश ऑन डिलीवरी है, दो सौ पचास रुपये।", "It is cash on delivery, two hundred and fifty rupees."),
        ("ओटीपी बता दीजिए, ऑर्डर कन्फर्म करना है।", "Please tell me the OTP, I have to confirm the order."),
        ("गार्ड अंदर नहीं जाने दे रहा।", "The guard is not letting me go inside."),
        ("राहुल जी से बात करनी है, ज़रूरी है।", "I need to talk to Rahul, it is important."),
        ("मैं बैंक से बोल रहा हूँ, आपका कार्ड ब्लॉक हो गया है।", "I am speaking from the bank, your card has been blocked."),
        ("कल सुबह फिर आऊँगा।", "I will come again tomorrow morning."),
        ("दरवाज़े पर रख दूँ?", "Shall I keep it at the door?"),
        ("ठीक है, धन्यवाद।", "Okay, thank you."),
        ("मंदिर के पास हूँ, और कितना दूर है?", "I am near the temple, how much farther is it?"),
        ("लिफ्ट बंद है, क्या आप नीचे आ सकते हैं?", "The lift is closed, can you come down?"),
        ("अमेज़न का पार्सल है, साइन करना होगा।", "It is an Amazon parcel, you will have to sign."),
        ("बारिश हो रही है, थोड़ी देर होगी।", "It is raining, there will be a little delay."),
        ("सोसाइटी का नाम क्या है?", "What is the name of the society?"),
        ("मैं कल शाम को कॉल करूँगा।", "I will call tomorrow evening."),
        ("आपका नंबर ऑर्डर में दिया था।", "Your number was given in the order."),
    ],
    "ta": [
        ("வணக்கம், உங்கள் ஆர்டர் வந்துவிட்டது, எங்கே கொடுக்க வேண்டும்?", "Hello, your order has arrived, where should I give it?"),
        ("நான் வாசலில் நிற்கிறேன், வீட்டு எண் என்ன?", "I am standing at the entrance, what is the house number?"),
        ("சார் வீட்டில் இல்லையா? நான் பிறகு அழைக்கிறேன்.", "Is sir not at home? I will call later."),
        ("பார்சலை செக்யூரிட்டியிடம் கொடுக்கலாமா?", "Can I give the parcel to security?"),
        ("ஐந்து நிமிடத்தில் வருகிறேன்.", "I will come in five minutes."),
        ("கேஷ் ஆன் டெலிவரி, முன்னூறு ரூபாய்.", "Cash on delivery, three hundred rupees."),
        ("லிஃப்ட் வேலை செய்யவில்லை, கீழே வர முடியுமா?", "The lift is not working, can you come down?"),
        ("ராகுலிடம் பேச வேண்டும், அவசரம்.", "I need to speak to Rahul, it is urgent."),
        ("நான் வங்கியிலிருந்து பேசுகிறேன்.", "I am speaking from the bank."),
        ("உங்கள் ஓடிபி சொல்லுங்கள்.", "Tell me your OTP."),
        ("நாளை காலை மறுபடியும் வருகிறேன்.", "I will come again tomorrow morning."),
        ("கதவு அருகில் வைத்துவிட்டு போகட்டுமா?", "Shall I leave it near the door and go?"),
        ("சரி, நன்றி.", "Okay, thank you."),
        ("கோவில் அருகில் இருக்கிறேன், இன்னும் எவ்வளவு தூரம்?", "I am near the temple, how much farther?"),
        ("அமேசான் பார்சல் இருக்கிறது, கையெழுத்து வேண்டும்.", "There is an Amazon parcel, a signature is needed."),
        ("மழை பெய்கிறது, கொஞ்சம் தாமதமாகும்.", "It is raining, it will be a little late."),
        ("அபார்ட்மெண்ட் பெயர் என்ன?", "What is the apartment name?"),
        ("இடம் கண்டுபிடிக்க முடியவில்லை.", "I could not find the place."),
        ("உங்கள் எண் ஆர்டரில் இருந்தது.", "Your number was in the order."),
        ("கேட் திறந்திருக்கிறதா?", "Is the gate open?"),
    ],
}

NAMES = ["Rahul", "Ava", "Apollo", "Swiggy", "Amazon", "Banjara", "Sri Sai"]


def facts(text: str) -> set[str]:
    return set(re.findall(r"\d+", text)) | {n.lower() for n in NAMES if n.lower() in text.lower()}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", type=Path, default=None, help="folder for the models (default: Hugging Face cache)")
    ap.add_argument("--langs", default="te,ta,hi")
    ap.add_argument("--out", type=Path, default=Path("mt_report.json"))
    args = ap.parse_args()
    from sacrebleu.metrics import CHRF

    chrf = CHRF()
    model = IndicTrans2(args.models, cache_size=0)
    started = time.monotonic()
    model.warm_up([lang.strip() for lang in args.langs.split(",")])
    report: dict = {"load_and_warm_s": round(time.monotonic() - started, 1), "summary": {}, "rows": []}
    for lang in [lang.strip() for lang in args.langs.split(",") if lang.strip()]:
        out_times, back_times, hyps, refs, kept = [], [], [], [], 0
        for text in REPLIES:
            t = time.monotonic()
            said = model.translate(text, "en", lang)
            out_times.append(time.monotonic() - t)
            t = time.monotonic()
            back = model.translate(said, lang, "en")
            back_times.append(time.monotonic() - t)
            hyps.append(back)
            refs.append(text)
            numbers = set(re.findall(r"\d+", text))
            ok = numbers <= set(re.findall(r"\d+", said)) and facts(text) <= facts(back)
            kept += ok
            report["rows"].append({"dir": f"en-{lang}", "src": text, "out": said, "back": back, "facts_kept": ok})
            print(f"en->{lang} {out_times[-1]:.2f}s {'' if ok else 'LOST '}| {text} | {said} | {back}", flush=True)
        caller_hyps, caller_refs, caller_times = [], [], []
        for text, ref in CALLERS.get(lang, []):
            t = time.monotonic()
            english = model.translate(text, lang, "en")
            caller_times.append(time.monotonic() - t)
            caller_hyps.append(english)
            caller_refs.append(ref)
            report["rows"].append({"dir": f"{lang}-en", "src": text, "out": english, "ref": ref})
            print(f"{lang}->en {caller_times[-1]:.2f}s | {text} | {english} | ref: {ref}", flush=True)
        report["summary"][lang] = {
            "replies": len(REPLIES),
            "reply_round_trip_chrf": round(chrf.corpus_score(hyps, [refs]).score, 1),
            "reply_numbers_and_names_kept": f"{kept}/{len(REPLIES)}",
            "en_to_lang_s_mean": round(statistics.mean(out_times), 3),
            "en_to_lang_s_p90": round(sorted(out_times)[int(0.9 * len(out_times))], 3),
            "callers": len(caller_hyps),
            "caller_to_en_chrf": round(chrf.corpus_score(caller_hyps, [caller_refs]).score, 1) if caller_hyps else None,
            "lang_to_en_s_mean": round(statistics.mean(back_times + caller_times), 3),
        }
        print(json.dumps({lang: report["summary"][lang]}), flush=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report["summary"], indent=1))


if __name__ == "__main__":
    main()
