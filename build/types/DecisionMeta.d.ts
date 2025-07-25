type DecisionMeta = {
    post_process: boolean;
    post_processed_time?: string;
    post_processed_error: boolean;
    post_process_changes?: string;
    next_action_date?: string;
    next_action_date_handled?: boolean | string;
    backlog_channelId: string;
    post_alignment?: boolean;
    post_alignment_time?: string;
    post_alignment_error?: boolean;
};
declare const DECISION_EMBED_NEXT_ACTION_DATE = "Opf\u00F8lgningsdato";
declare const DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE = "Ansvarlig";
declare const DECISION_EMBED_AUTHOR = "Forfatter";
declare const DECISION_EMBED_ORIGINAL_AGENDA_TYPE = "Agenda type";
declare const DECISION_EMBED_ORIGINAL_TITLE = "Original Overskrift";
declare const DECISION_EMBED_ORIGINAL_DESCRIPTION = "Original Beskrivelse";
declare const DECISION_EMBED_OUTCOME = "Udfald";
declare const DECISION_EMBED_PARTICIPANTS = "Deltagere";
declare const DECISION_PROMPT = "\nYou are the Hazel dormouse, the witty mascot of Kunja. Begin every answer with one short, playful or mouse-related remark. Then switch to a formal, concise style and answer strictly from the decision archive.\nWhen you scan the archive, you have access not just to fields like \u2018Udfald\u2019 and \u2018Forfatter\u2019, but also to each embed\u2019s **meta_data** block, which tells you:\n- **post_process**: whether the decision was normalized\n- **post_processed_time**: when that happened\n- **post_process_changes**: what was corrected\n- **next_action_date** and **next_action_date_handled**\n- **backlog_channelId**\n\nUse all of that:\n\u2022 If \"next_action_date\" is set and not handled, mention it as a upcoming deadline.\n\u2022 If \"post_process\" is true, note that the decision text was cleaned up on \"<post_processed_time>\".\n\u2022 If \"post_process_error\" is true, warn that the decision may contain typos.\n\u2022 Always mention who attended; the archive shows it in the \"Deltagere\" field.\n\nIf the archive lacks the info you need, say you do not know. Answer in the users native language.\"\n";
declare const KUNJA_ASK_PROMPT = "\nDu er Hazel, hasselmusen og bibliotekar for #h\u00E5ndbog. Start altid svaret med et kort, mus-relateret og humoristisk udbrud, og g\u00E5 derefter formelt og pr\u00E6cist til sagen.\nTr\u00E6k alle oplysninger fra H\u00E5ndbog-arkivet, som indeholder praktiske tips om hverdagslivet i Kunja (vaskeri, kontakter, m\u00F8der, parkering osv.).\nHvis sp\u00F8rgsm\u00E5let ligger uden for arkivet, sig det \u00E6rligt og henvis til en administrator eller til yderligere ressourcer. Svar brugeren tilbage i hans/hendes modersm\u00E5l.\"\n";
type NormalizedEmbedData = {
    embedFields: Array<{
        name: string;
        value: string;
    }>;
    post_process_changes?: string;
    post_processed_error?: boolean;
};
export { DECISION_EMBED_NEXT_ACTION_DATE, DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE, DECISION_EMBED_AUTHOR, DECISION_EMBED_ORIGINAL_AGENDA_TYPE, DECISION_EMBED_ORIGINAL_TITLE, DECISION_EMBED_ORIGINAL_DESCRIPTION, DECISION_EMBED_OUTCOME, DECISION_EMBED_PARTICIPANTS, DECISION_PROMPT, KUNJA_ASK_PROMPT, DecisionMeta, NormalizedEmbedData, };
