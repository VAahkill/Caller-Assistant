import { OnboardingFrame, OnboardingPoints, type OnboardingPoint } from '../../components/domain/OnboardingFrame';

const POINTS: OnboardingPoint[] = [
  { icon: 'call-outline', title: "Answers when you can't", text: 'Talks to callers in English, Hindi, Telugu or Tamil, and takes messages.' },
  { icon: 'shield-checkmark-outline', title: 'Keeps you safe', text: 'Never shares OTPs, PINs or bank details, and warns you about scams.' },
  { icon: 'chatbubbles-outline', title: 'You stay in charge', text: 'Watch calls live, answer its questions, or step in yourself.' },
  { icon: 'home-outline', title: 'Free and private', text: 'Runs on your own computer. No paid services, no cloud.' },
];

/** Welcome: what OpenCall does, then into setup. */
export default function Welcome() {
  return (
    <OnboardingFrame step="index" title="Your own phone receptionist" subtitle="Set it up in a few minutes." primary={{ title: 'Get started' }} noSkip>
      <OnboardingPoints points={POINTS} />
    </OnboardingFrame>
  );
}
