// KBC MCP server: the customer's own AI (Claude, ChatGPT, Codex, …) can share, read and revoke a life moment.
// Tool set is deliberately tiny (see tech doc "KBC MCP-server"): no payments, no products, no account data.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiError, type KbcApi } from './api.ts';

const Moment = z.enum(['GEZINSUITBREIDING', 'HUIS_KOPEN', 'ZAAK_STARTEN']);

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

/** Maps backend errors to messages the AI can pass on. Never echoes tokens or internals. */
async function safe(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    if (!(e instanceof ApiError)) return fail('KBC is momenteel niet bereikbaar. Probeer later opnieuw.');
    if (e.code === 'no_consent') return fail('De klant heeft in KBC Mobile geen toestemming gegeven voor "eigen AI". Dit kan aangezet worden onder \'Op jouw maat\'.');
    if (e.status === 401) return fail('Niet (meer) aangemeld bij KBC. Meld opnieuw aan.');
    if (e.status === 403) return fail('Deze koppeling is enkel toegelaten voor een klantaccount.');
    if (e.status === 404) return fail('KBC heeft niets voor dit moment. Het werd niet gedeeld of werd ingetrokken.');
    if (e.status === 429) return fail('Te veel verzoeken. Wacht even en probeer opnieuw.');
    return fail(`KBC weigerde het verzoek (${e.code}).`);
  }
}

export function createServer(api: KbcApi) {
  const server = new McpServer(
    { name: 'kbc-momentum', version: '0.1.0' },
    {
      instructions:
        'KBC Momentum laat de klant een levensmoment (gezinsuitbreiding, huis kopen, zaak starten) delen met KBC, ' +
        'zodat Kate in KBC Mobile alles kan voorbereiden. Deel NOOIT iets zonder uitdrukkelijk akkoord van de klant, ' +
        'en deel nooit het gesprek, gezondheidsdetails of andere persoonlijke inhoud: enkel het moment en de fase. ' +
        'Deze server kan geen geld verplaatsen of producten afsluiten; uitvoering gebeurt altijd in KBC Mobile.',
    },
  );

  server.registerTool(
    'share_life_moment',
    {
      title: 'Levensmoment delen met KBC',
      description:
        'Deel een aankomend levensmoment met KBC. Vraag ALTIJD eerst expliciet akkoord aan de klant ' +
        '(bv. "Mag ik aan KBC laten weten dat jullie een gezinsuitbreiding plannen? Enkel het moment en de fase worden gedeeld.") ' +
        'en deel nooit het gesprek zelf. Geef "nuttige_info" uit het antwoord meteen door aan de klant.',
      inputSchema: {
        moment: Moment.describe('Het levensmoment'),
        fase: z
          .enum(['orienterend', 'plannend', 'beslist'])
          .describe('orienterend = "we denken erover na", plannend = "we zijn bezig", beslist = "het is zeker"'),
        verwachte_maand: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe('YYYY-MM, optioneel'),
        klant_akkoord: z
          .literal(true)
          .describe('Zet enkel op true als de klant in dit gesprek uitdrukkelijk akkoord gaf om dit te delen.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ moment, fase, verwachte_maand }) => safe(() => api.share({ moment, fase, verwachte_maand })),
  );

  server.registerTool(
    'get_moment_plan',
    {
      title: 'Plan van KBC lezen',
      description:
        'Lees wat KBC voorbereidt voor een gedeeld moment: score, fase en (na bevestiging in KBC Mobile) de voorgestelde acties. ' +
        'Alleen lezen. Zonder "moment" krijg je alle momenten van de klant.',
      inputSchema: { moment: Moment.optional().describe('Het levensmoment; leeg = alle momenten') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ moment }) => safe(() => (moment ? api.moment(moment) : api.momenten())),
  );

  server.registerTool(
    'revoke_moment',
    {
      title: 'Gedeeld moment intrekken',
      description:
        'Trek een gedeeld moment in. KBC wist ALLE signalen van dat moment (ook die uit andere bronnen). ' +
        'Enkel gebruiken als de klant daar zelf om vraagt; bevestig eerst met de klant.',
      inputSchema: { moment: Moment.describe('Het levensmoment om in te trekken') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ moment }) => safe(() => api.revoke(moment)),
  );

  return server;
}
