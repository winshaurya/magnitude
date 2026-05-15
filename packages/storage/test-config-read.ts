import { createStorageClient } from './src/index'

const storage = await createStorageClient()
const policy = await storage.config.getContextLimitPolicy()
console.log('Policy from storage:', JSON.stringify(policy, null, 2))

const fullConfig = await storage.config.loadFull()
console.log('Full config:', JSON.stringify(fullConfig, null, 2))
