import { BrandMark, OnboardingFrame, OnboardingPoints, type OnboardingPoint } from '../../components/domain/OnboardingFrame';

const POINTS: OnboardingPoint[] = [
  { icon: 'call-outline', title: "Answers when you can't", text: 'Talks to callers in English, Hindi, Telugu or Tamil, and takes messages.' },
  { icon: 'language-outline', title: 'Translates live', text: 'Read every call in your language, and reply in it. Callers hear you in theirs.' },
  { icon: 'shield-checkmark-outline', title: 'Keeps you safe', text: 'Never shares OTPs, PINs or bank details, and warns you about scams.' },
  { icon: 'home-outline', title: 'Free and private', text: 'Runs on your own computer. No paid services, no cloud.' },
];

/** Welcome: what OpenCall does, then into setup. */
export default function Welcome() {
  return (
    <OnboardingFrame
      step="index"
      title="Your own phone receptionist"
      subtitle="Set it up in a few minutes. Every step can be changed later."
      primary={{ title: 'Get started' }}
      art={<BrandMark />}
      noSkip
    >
      <OnboardingPoints points={POINTS} />
    </OnboardingFrame>
  );
}
