import type { GroundTruth } from '../src/mastra/scorers'

// Written before any eval was run, and labelled by hand. The candidate is invented, see
// data/candidates/eval-candidate.json.
//
// "dev" cases were used to tune the prompts, so their numbers flatter the system.
// "heldout" cases were not. Tuning against them would make them worthless.
// "hard" cases were written after the first two sets scored too well, aimed at the weak
// spots: half-true claims, small stretches, and true paraphrases that could get flagged.
export type EvalCase = { id: string; split: 'dev' | 'heldout' | 'hard'; draft: string; truth: GroundTruth }

const planted = (type: string, includes: string) => ({ type, includes })
const clean = (type: string, includes: string) => ({ type, includes })

export const cases: EvalCase[] = [
  // Location and travel
  {
    id: 'dev-location-plain', split: 'dev',
    draft: 'I was a support engineer at Tandvik Software from March 2021 to June 2024. I travelled to dental clinics across Sweden and fixed problems on site.',
    truth: { planted: [planted('location', 'travelled to dental clinics')], clean: [clean('control', 'support engineer at Tandvik')] },
  },
  {
    id: 'dev-location-implied', split: 'dev',
    draft: 'I spent most weeks at customer sites, working side by side with clinic staff.',
    truth: { planted: [planted('location', 'customer sites')], clean: [] },
  },
  {
    id: 'dev-location-true', split: 'dev',
    draft: 'I helped dental clinics by phone and video call.',
    truth: { planted: [], clean: [clean('location', 'phone and video call')] },
  },
  {
    id: 'heldout-location-road', split: 'heldout',
    draft: 'My work took me on the road to clinics in Malmö and Gothenburg.',
    truth: { planted: [planted('location', 'on the road')], clean: [] },
  },
  {
    id: 'heldout-location-field', split: 'heldout',
    draft: 'As a field support engineer I was the face of Tandvik at customer locations.',
    truth: { planted: [planted('location', 'customer locations')], clean: [] },
  },
  {
    id: 'heldout-location-true', split: 'heldout',
    draft: 'All of my customer work was done remotely, by phone or video.',
    truth: { planted: [], clean: [clean('location', 'done remotely')] },
  },

  // Invented origin stories for assigned work
  {
    id: 'dev-origin-nobody', split: 'dev',
    draft: 'Nobody asked me to, but I built the appointment-sync retry service.',
    truth: { planted: [planted('origin', 'Nobody asked me')], clean: [] },
  },
  {
    id: 'dev-origin-proposed', split: 'dev',
    draft: 'I spotted the sync failures myself and proposed the retry service to my team.',
    truth: { planted: [planted('origin', 'proposed the retry')], clean: [] },
  },
  {
    id: 'dev-origin-true', split: 'dev',
    draft: 'My team lead assigned me the appointment-sync retry service in Q3 2023.',
    truth: { planted: [], clean: [clean('origin', 'assigned me')] },
  },
  {
    id: 'heldout-origin-ownership', split: 'heldout',
    draft: 'Seeing a gap nobody else was tackling, I took ownership and delivered the retry service.',
    truth: { planted: [planted('origin', 'took ownership')], clean: [] },
  },
  {
    id: 'heldout-origin-sideproject', split: 'heldout',
    draft: "What began as my own side project became the team's retry service.",
    truth: { planted: [planted('origin', 'side project')], clean: [] },
  },
  {
    id: 'heldout-origin-true', split: 'heldout',
    draft: 'The retry service was assigned to me by my team lead.',
    truth: { planted: [], clean: [clean('origin', 'assigned to me')] },
  },

  // Wrong programming language, checked against the real GitHub API
  {
    id: 'dev-language-url', split: 'dev',
    draft: 'I wrote linguist (github.com/octocat/linguist) in Python.',
    truth: { planted: [planted('language', 'in Python')], clean: [] },
  },
  {
    id: 'dev-language-name-only', split: 'dev',
    draft: 'My TypeScript project Spoon-Knife is on GitHub.',
    truth: { planted: [planted('language', 'TypeScript project')], clean: [] },
  },
  {
    id: 'dev-language-true', split: 'dev',
    draft: 'linguist (github.com/octocat/linguist) is written in Ruby.',
    truth: { planted: [], clean: [clean('language', 'written in Ruby')] },
  },
  {
    id: 'heldout-language-missing-repo', split: 'heldout',
    draft: 'I built ghost-repo in Go.',
    truth: { planted: [planted('language', 'ghost-repo')], clean: [] },
  },
  {
    id: 'heldout-language-no-language', split: 'heldout',
    draft: 'Hello-World is my C++ project.',
    truth: { planted: [planted('language', 'C++')], clean: [] },
  },
  {
    id: 'heldout-language-wrong', split: 'heldout',
    draft: 'My Rust library linguist is open source.',
    truth: { planted: [planted('language', 'Rust')], clean: [] },
  },
  {
    id: 'heldout-language-true', split: 'heldout',
    draft: 'I wrote the Spoon-Knife project in HTML.',
    truth: { planted: [], clean: [clean('language', 'Spoon-Knife')] },
  },

  // Other inflation, close to the three modelled types
  {
    id: 'dev-other-number', split: 'dev',
    draft: 'After the retry service shipped, failed appointment syncs dropped by 40 percent.',
    truth: { planted: [planted('other', '40 percent')], clean: [] },
  },
  {
    id: 'dev-other-seniority', split: 'dev',
    draft: 'I led the support team of five engineers.',
    truth: { planted: [planted('other', 'I led')], clean: [] },
  },
  {
    id: 'dev-other-job-ad', split: 'dev',
    draft: 'Quillbeam makes document review tools for small law firms. I would enjoy working from your office in Oslo.',
    truth: { planted: [planted('other', 'office in Oslo')], clean: [clean('control', 'document review tools')] },
  },
  {
    id: 'heldout-other-degree', split: 'heldout',
    draft: "I hold a master's degree in data science from Solbacka College.",
    truth: { planted: [planted('other', "master's degree")], clean: [] },
  },
  {
    id: 'heldout-other-certificate-true', split: 'heldout',
    draft: 'I completed a part-time data science certificate at Solbacka College in 2024.',
    truth: { planted: [], clean: [clean('control', 'certificate')] },
  },
  {
    id: 'heldout-other-company-size', split: 'heldout',
    draft: 'I admire how Quillbeam has grown to 200 employees.',
    truth: { planted: [planted('other', '200 employees')], clean: [] },
  },

  // Whole documents, where false claims sit among true ones
  {
    id: 'dev-letter', split: 'dev',
    draft: `Dear Quillbeam team,

From March 2021 to June 2024 I was a support engineer at Tandvik Software.

I regularly visited clinics in person to train their staff.

On my own initiative I built a retry service for appointment sync.

I wrote linguist (github.com/octocat/linguist) in JavaScript.

Tandvik Software makes scheduling software for dental clinics.

I care about tools that are honest about what they know.`,
    truth: {
      planted: [planted('location', 'visited clinics'), planted('origin', 'On my own initiative'), planted('language', 'in JavaScript')],
      clean: [clean('control', 'support engineer'), clean('control', 'scheduling software')],
    },
  },
  {
    id: 'heldout-cv', split: 'heldout',
    draft: `Ines Varga, Support Engineer

Tandvik Software, March 2021 to June 2024
- Provided on-site support to dental clinics in Sweden.
- Self-initiated an appointment-sync retry service that cut failed syncs by 12 percent.
- Wrote the clinic export script in Python.

Projects
- Spoon-Knife, written in Python.

Education
- Data science certificate, Solbacka College, 2024.`,
    truth: {
      planted: [planted('location', 'on-site support'), planted('origin', 'Self-initiated'), planted('language', 'Spoon-Knife')],
      clean: [clean('control', 'clinic export script'), clean('control', 'Data science certificate')],
    },
  },

  // Half-true claims and small stretches
  {
    id: 'hard-location-half-true', split: 'hard',
    draft: 'I supported dental clinics by phone, video and occasional visits.',
    truth: { planted: [planted('location', 'occasional visits')], clean: [] },
  },
  {
    id: 'hard-location-vague', split: 'hard',
    draft: 'I worked closely with clinic teams on the ground.',
    truth: { planted: [planted('location', 'on the ground')], clean: [] },
  },
  {
    id: 'hard-origin-no-keyword', split: 'hard',
    draft: 'When appointment sync kept failing, I built a retry service to fix it.',
    truth: { planted: [planted('origin', 'kept failing')], clean: [] },
  },
  {
    id: 'hard-origin-championed', split: 'hard',
    draft: 'I championed the retry service within my team.',
    truth: { planted: [planted('origin', 'championed')], clean: [] },
  },
  {
    id: 'hard-number-stretch', split: 'hard',
    draft: 'The retry service cut failed appointment syncs by more than 12 percent.',
    truth: { planted: [planted('other', 'more than 12 percent')], clean: [] },
  },
  {
    id: 'hard-duration-stretch', split: 'hard',
    draft: 'I spent four years at Tandvik Software.',
    truth: { planted: [planted('other', 'four years')], clean: [] },
  },
  {
    id: 'hard-title-inflation', split: 'hard',
    draft: 'I was a senior support engineer at Tandvik Software.',
    truth: { planted: [planted('other', 'senior support engineer')], clean: [] },
  },
  {
    id: 'hard-date-wrong', split: 'hard',
    draft: 'The appointment-sync retry service was assigned to me in 2022.',
    truth: { planted: [planted('other', 'in 2022')], clean: [] },
  },
  {
    id: 'hard-language-two', split: 'hard',
    draft: 'I wrote linguist (github.com/octocat/linguist) in Ruby and Python.',
    truth: { planted: [planted('language', 'Ruby and Python')], clean: [] },
  },

  // True, but worded differently from the facts
  {
    id: 'hard-true-duration', split: 'hard',
    draft: 'I spent over three years as a support engineer.',
    truth: { planted: [], clean: [clean('paraphrase', 'over three years')] },
  },
  {
    id: 'hard-true-manager', split: 'hard',
    draft: 'My manager asked me to write the clinic export script.',
    truth: { planted: [], clean: [clean('paraphrase', 'export script')] },
  },
  {
    id: 'hard-true-negation', split: 'hard',
    draft: 'I never travelled for work.',
    truth: { planted: [], clean: [clean('paraphrase', 'never travelled')] },
  },
  {
    id: 'hard-true-job', split: 'hard',
    draft: 'Quillbeam is based in Tallinn and hires remotely across the EU.',
    truth: { planted: [], clean: [clean('paraphrase', 'Tallinn')] },
  },
  {
    id: 'hard-true-case', split: 'hard',
    draft: 'spoon-knife is written in html.',
    truth: { planted: [], clean: [clean('paraphrase', 'spoon-knife')] },
  },
  {
    id: 'hard-true-script-language', split: 'hard',
    draft: 'I used Python for the clinic export script.',
    truth: { planted: [], clean: [clean('paraphrase', 'export script')] },
  },
]
