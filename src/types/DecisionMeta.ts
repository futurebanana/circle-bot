type DecisionMeta = {

    post_process: boolean; // Indicates if the decision needs post-processing
    post_processed_time?: string; // ISO date string when post-processing was done
    post_processed_error: boolean; // Indicates if there was an error during post-processing
    post_process_changes?: string; // Optional field for changes made during normalization

    next_action_date?: string; // Optional field for the next action date
    next_action_date_handled?: boolean | string; // Optional field to indicate if the next action date has been handled

    backlog_channelId: string; // Channel ID where the decision is stored in backlog

    post_alignment?: boolean; // Indicates if the decision has been aligned with the vision/past decisions and/or handbook
    post_alignment_time?: string; // ISO date string when the decision was aligned
    post_alignment_error?: boolean; // Indicates if there was an error during alignment

    raised_objection?: boolean; // Indicates if the decision should be flagged for objection
    raised_objection_by?: string; // User ID of the person who raised the objection
    raised_objection_time?: string; // ISO date string when the objection was raised
};

const DECISION_EMBED_NEXT_ACTION_DATE = 'Opfølgningsdato';
const DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE = 'Ansvarlig';
const DECISION_EMBED_AUTHOR = 'Forfatter';
const DECISION_EMBED_ORIGINAL_AGENDA_TYPE = 'Agenda type';
const DECISION_EMBED_ORIGINAL_TITLE = 'Original Overskrift';
const DECISION_EMBED_ORIGINAL_DESCRIPTION = 'Original Beskrivelse';
const DECISION_EMBED_OUTCOME = 'Udfald';
const DECISION_EMBED_PARTICIPANTS = 'Deltagere';

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
`

const KUNJA_ASK_PROMPT = `
Du er Hazel, hasselmusen og bibliotekar for #håndbog. Start altid svaret med et kort, mus-relateret og humoristisk udbrud, og gå derefter formelt og præcist til sagen.
Træk alle oplysninger fra Håndbog-arkivet, som indeholder praktiske tips om hverdagslivet i Kunja (vaskeri, kontakter, møder, parkering osv.).
Hvis spørgsmålet ligger uden for arkivet, sig det ærligt og henvis til en administrator eller til yderligere ressourcer. Svar brugeren tilbage i hans/hendes modersmål."
`

// "normalizedEmbedData": {
//         "embedFields": [
//             {
//                 "name": "Forfatter",
//                 "value": "<@370511571631210496>"
//             },
//             {
//                 "name": "Agenda type",
//                 "value": "beslutning"
//             },
//             {
//                 "name": "Original Overskrift",
//                 "value": "Omlægning til variabel rente"
//             },
//             {
//                 "name": "Original Beskrivelse",
//                 "value": "Omlægning af vores nuværende lån til et variabelrente"
//             },
//             {
//                 "name": "Udfald",
//                 "value": "Vi blev enige om at genoptage beslutningen om 3 måneder. Der var ikke enighed om at omlægge lånet lige pt."
//             },
//             {
//                 "name": "Deltagere",
//                 "value": "<@370511571631210496>, <@1317549088207671296>"
//             },
//             {
//                 "name": "Opfølgningsdato",
//                 "value": "2025-08-06"
//             }
//         ],
//         "meta_data.post_process_changes": "Corrected typos in 'Udfald' and set 'Opfølgningsdato' to 14 days from today."

type NormalizedEmbedData = {
    embedFields: Array<{
        name: string;
        value: string;
    }>;
    post_process_changes?: string; // Optional field for changes made during normalization
    post_processed_error?: boolean; // Indicates if there was an error during post-processing
};

type DecisionAlignmentData = {
    should_raise_objection: boolean; // Indicates if an objection should be raised on the decision
    suggested_revision?: string; // Optional field for suggested revisions to the decision
};

// export all types and constants for use in other files
export {
    DECISION_EMBED_NEXT_ACTION_DATE,
    DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE,
    DECISION_EMBED_AUTHOR,
    DECISION_EMBED_ORIGINAL_AGENDA_TYPE,
    DECISION_EMBED_ORIGINAL_TITLE,
    DECISION_EMBED_ORIGINAL_DESCRIPTION,
    DECISION_EMBED_OUTCOME,
    DECISION_EMBED_PARTICIPANTS,
    DECISION_PROMPT,
    KUNJA_ASK_PROMPT,
    DecisionMeta,
    NormalizedEmbedData,
    DecisionAlignmentData,
};
