import { matchNodes as matchNodesArkui } from './nodeMatcher.js'
import { matchNodes as matchNodesWeb }   from './web/index.js'

export function matchNodes(designNodes, devNodes, options = {}) {
  if (options.platform === 'web') {
    return matchNodesWeb(designNodes, devNodes, options)
  }
  return matchNodesArkui(designNodes, devNodes, options)
}
