import { buildRegistry, SearchRegistry } from './searchRegistry'
import { projectsSource } from './projectsSource'
import { spacesSource } from './spacesSource'
import { sessionsSource } from './sessionsSource'
import { tabsSource } from './tabsSource'
import { settingsSource } from './settingsSource'
import { commandsSource } from './commandsSource'

/** Singleton registry wired with every built-in source. */
export const defaultRegistry: SearchRegistry = buildRegistry([
  commandsSource,
  projectsSource,
  spacesSource,
  sessionsSource,
  tabsSource,
  settingsSource
])
