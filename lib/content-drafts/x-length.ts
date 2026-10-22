import twitterText from 'twitter-text'

/** X's transformed URL length, from twitter-text v3. */
export const X_LINK_LENGTH = 23

/** The canonical twitter-text v3 count, matching the backend parser. */
export function xLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength
}
