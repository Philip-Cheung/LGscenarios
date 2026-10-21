import coffeeChatV3 from '../../content/scenarios/coffee-chat.v4.json'
import sampleDoorstepV5 from '../../content/scenarios/sample-doorstep.v6.json'
import christiansTooV1 from '../../content/scenarios/week-one-christians-too.v1.json'
import weekOneV1 from '../../content/scenarios/week-one-first-vision.v1.json'
import whoIsGodV1 from '../../content/scenarios/who-is-god.v1.json'
import { scenarioFileSchema, toStoredContent, type ScenarioContent } from '../lib/content'
import { conversationFileSchema, type ConversationContent } from '../lib/conversation'

/**
 * Scenario files rendered without a backend, for the development preview and
 * tests only. The app itself loads published content from Supabase.
 */
export const whoIsGod: ScenarioContent = toStoredContent(scenarioFileSchema.parse(whoIsGodV1))
export const coffeeChat: ScenarioContent = toStoredContent(scenarioFileSchema.parse(coffeeChatV3))
export const sampleDoorstep: ScenarioContent = toStoredContent(scenarioFileSchema.parse(sampleDoorstepV5))
export const weekOne: ScenarioContent = toStoredContent(scenarioFileSchema.parse(weekOneV1))
export const christiansToo: ConversationContent = toStoredContent(conversationFileSchema.parse(christiansTooV1))
