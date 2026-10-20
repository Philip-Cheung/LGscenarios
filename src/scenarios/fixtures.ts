import coffeeChatV2 from '../../content/scenarios/coffee-chat.v2.json'
import sampleDoorstepV4 from '../../content/scenarios/sample-doorstep.v4.json'
import whoIsGodV1 from '../../content/scenarios/who-is-god.v1.json'
import { scenarioFileSchema, toStoredContent, type ScenarioContent } from '../lib/content'

/**
 * Scenario files rendered without a backend, for the development preview and
 * tests only. The app itself loads published content from Supabase.
 */
export const whoIsGod: ScenarioContent = toStoredContent(scenarioFileSchema.parse(whoIsGodV1))
export const coffeeChat: ScenarioContent = toStoredContent(scenarioFileSchema.parse(coffeeChatV2))
export const sampleDoorstep: ScenarioContent = toStoredContent(scenarioFileSchema.parse(sampleDoorstepV4))
