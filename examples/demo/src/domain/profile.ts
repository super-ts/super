/** What the server stores: the form converts its values into this `input` (without the confirmation). */
export type ProfileInput = {
  name: string;
  email: string;
  password: string;
  age: number | null;
  website: string;
  bio: string;
  country: string;
  languages: string[];
  plan: 'free' | 'pro' | 'team';
  newsletter: boolean;
  interests: string[];
  birthdate: string;
  meetingTime: string;
  color: string;
  volume: number;
  avatar: File | null;
  phones: { label: string; number: string }[];
};
