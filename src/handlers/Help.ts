import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { Discord } from './Discord';
import { backlogChannelToCircle } from '../index';

/**
 * Class for meeting-related functionalities.
 * Handles commands like starting a meeting and picking participants.
 */
class Help extends Discord {

    public async help(i: ChatInputCommandInteraction) {

        const helpText = `
🧀 **Kunja Hasselmus-bot – Hjælp**

Hej! Jeg er husmusen, der holder styr på møder, backlog, beslutninger og opfølgning. Her er hvad jeg kan:

### Søg i vores Vision/Håndbog med naturligt sprog.
\`\`\`
/kunja <spørgsmål>
\`\`\`
Spørg mig om vores vision, håndbog som feks hvor vaskeriet er, eller hvordan vi håndterer beslutninger. Jeg vil søge i vores Vision og Håndbog kanaler og give dig svar.
### Start et nyt møde
\`\`\`
/møde start
\`\`\`
Start et nyt møde i cirklens backlog-kanal og vælg deltagere.
### Ændre deltagerlisten for det igangværende møde.
\`\`\`
/møde deltagere
\`\`\`
### Opret et nyt mødepunkt
\`\`\`
/ny type:<beslutning|undersøgelse|orientering>
\`\`\`
Du udfylder titel og beskrivelse, og jeg poster et embed med knappen **“Gem i beslutninger”**.

### 💾 Knappen “Gem i beslutninger”
➡️ Hvis intet møde er startet, beder jeg dig køre \`/møde start\`.
➡️ Når mødet kører, kan du udfylde udfald og gemme punktet som en beslutning.

### Søg i beslutnings-arkivet med naturligt sprog.
\`\`\`
/beslutninger søg <spørgsmål>
\`\`\`
### Vis alle beslutninger med ubehandlede opfølgningsdatoer.
\`\`\`
/beslutninger opfølgning
\`\`\`
### Vis cirkler, deres backlog-kanaler, skrive-roller og aktuelle medlemmer.
\`\`\`
/cirkler vis
\`\`\`
### 🔐 Roller & rettigheder
- Kun brugere med skrive rettigheder til cirklens backlog kan oprette nye punkter.
- Alle kan læse beslutninger og følge op.
`;

        await i.reply({ content: helpText, flags: MessageFlags.Ephemeral });
    }

}

export { Help };
