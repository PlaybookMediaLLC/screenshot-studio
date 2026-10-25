/** Original writing exercises; examples illustrate structure and never supply the writer's facts. */
export const WRITING_PROMPTS = [
  {
    id: 'lesson', title: 'Share a lesson',
    instruction: 'Help me write a short lesson learned. Ask what happened, what I changed, and what evidence supports the lesson. Use only facts I supply.',
    example: 'I used to write the announcement first. Now I start with the question a customer would ask. It makes the next paragraph much easier to choose.',
  },
  {
    id: 'explain', title: 'Explain a useful idea',
    instruction: 'Help me explain one idea to a beginner with a concrete example. Ask for the idea and audience before drafting; avoid unsupported claims.',
    example: 'A checklist works best at the moment you need it. Put the release checklist beside the release button, where the next action is clear.',
  },
  {
    id: 'announcement', title: 'Announce an improvement',
    instruction: 'Help me announce a product improvement: the prior problem, the new behavior, who benefits, and one next step. Ask for missing release facts.',
    example: 'You can now name a saved view. Give each view the name of the question it answers, then open it when that question comes up again.',
  },
  {
    id: 'process', title: 'Show your process',
    instruction: 'Turn a process I describe into a practical thread. Ask for the steps, a real example, and any limitations. Keep each post useful on its own.',
    example: 'Before sharing a chart, I write its takeaway as a sentence. If the chart cannot support that sentence, I change the chart or the claim.',
  },
  {
    id: 'discussion', title: 'Invite a discussion',
    instruction: 'Help me invite useful replies about a real tradeoff. Ask for the tradeoff, my experience, and the audience. End with a specific open question.',
    example: 'A short review is easy to finish; a detailed review can catch more. Which part of your review process deserves the most time, and why?',
  },
  {
    id: 'notes', title: 'Turn notes into a post',
    instruction: 'Help me turn rough notes or a voice-memo transcript into a clear post. Ask me to paste the notes. Preserve uncertainty, flag missing evidence, and invent no facts.',
    example: 'Notes: confusing labels; tested clearer names; need more feedback. Post: We are testing clearer names for saved views. The first round helped us find confusing labels; the next round will tell us which names work better.',
  },
] as const
