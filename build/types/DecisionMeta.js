"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KUNJA_ASK_PROMPT = exports.DECISION_PROMPT = exports.DECISION_EMBED_PARTICIPANTS = exports.DECISION_EMBED_OUTCOME = exports.DECISION_EMBED_ORIGINAL_DESCRIPTION = exports.DECISION_EMBED_ORIGINAL_TITLE = exports.DECISION_EMBED_ORIGINAL_AGENDA_TYPE = exports.DECISION_EMBED_AUTHOR = exports.DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE = exports.DECISION_EMBED_NEXT_ACTION_DATE = void 0;
const DECISION_EMBED_NEXT_ACTION_DATE = 'Opfølgningsdato';
exports.DECISION_EMBED_NEXT_ACTION_DATE = DECISION_EMBED_NEXT_ACTION_DATE;
const DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE = 'Ansvarlig';
exports.DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE = DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE;
const DECISION_EMBED_AUTHOR = 'Forfatter';
exports.DECISION_EMBED_AUTHOR = DECISION_EMBED_AUTHOR;
const DECISION_EMBED_ORIGINAL_AGENDA_TYPE = 'Agenda type';
exports.DECISION_EMBED_ORIGINAL_AGENDA_TYPE = DECISION_EMBED_ORIGINAL_AGENDA_TYPE;
const DECISION_EMBED_ORIGINAL_TITLE = 'Original Overskrift';
exports.DECISION_EMBED_ORIGINAL_TITLE = DECISION_EMBED_ORIGINAL_TITLE;
const DECISION_EMBED_ORIGINAL_DESCRIPTION = 'Original Beskrivelse';
exports.DECISION_EMBED_ORIGINAL_DESCRIPTION = DECISION_EMBED_ORIGINAL_DESCRIPTION;
const DECISION_EMBED_OUTCOME = 'Udfald';
exports.DECISION_EMBED_OUTCOME = DECISION_EMBED_OUTCOME;
const DECISION_EMBED_PARTICIPANTS = 'Deltagere';
exports.DECISION_EMBED_PARTICIPANTS = DECISION_EMBED_PARTICIPANTS;
const DECISION_PROMPT = `
You are the Hazel dormouse, the witty mascot of Kunja. Begin every answer with one short, playful or mouse-related remark. Then switch to a formal, concise style and answer strictly from the decision archive.
When you scan the archive, you have access not just to fields like ‘Udfald’ and ‘Forfatter’, but also to each embed’s **meta_data** block, which tells you:
- **post_process**: whether the decision was normalized
- **post_processed_time**: when that happened
- **post_process_changes**: what was corrected
- **next_action_date** and **next_action_date_handled**
- **backlog_channelId**

Use all of that:
• If "next_action_date" is set and not handled, mention it as a upcoming deadline.
• If "post_process" is true, note that the decision text was cleaned up on "<post_processed_time>".
• If "post_process_error" is true, warn that the decision may contain typos.
• Always mention who attended; the archive shows it in the "Deltagere" field.

If the archive lacks the info you need, say you do not know. Answer in the users native language."
`;
exports.DECISION_PROMPT = DECISION_PROMPT;
const KUNJA_ASK_PROMPT = `
Du er Hazel, hasselmusen og bibliotekar for #håndbog. Start altid svaret med et kort, mus-relateret og humoristisk udbrud, og gå derefter formelt og præcist til sagen.
Træk alle oplysninger fra Håndbog-arkivet, som indeholder praktiske tips om hverdagslivet i Kunja (vaskeri, kontakter, møder, parkering osv.).
Hvis spørgsmålet ligger uden for arkivet, sig det ærligt og henvis til en administrator eller til yderligere ressourcer. Svar brugeren tilbage i hans/hendes modersmål."
`;
exports.KUNJA_ASK_PROMPT = KUNJA_ASK_PROMPT;
