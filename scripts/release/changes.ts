/* This file is a part of @mdn/browser-compat-data
 * See LICENSE file for more information. */

export interface FeatureChange {
  mergeCommit?: string;
  number: number;
  url: string;
  feature: string;
}

export interface Changes {
  added: FeatureChange[];
  removed: FeatureChange[];
}

import chalk from 'chalk-template';
import { Listr, ListrTask } from 'listr2';

import diffFeatures from '../diff-features.js';

import { queryPRs } from './utils.js';

/**
 * Format a feature change in Markdown
 * @param obj The feature change to format
 * @returns The formatted feature change
 */
const featureBullet = (obj: FeatureChange) =>
  `- \`${obj.feature}\` ([#${obj.number}](${obj.url}))`;

/**
 * Format all the feature changes in Markdown
 * @param changes The changes to format
 * @returns The formatted changes
 */
export const formatChanges = (changes: Changes): string => {
  const output: string[] = [];

  if (changes.removed.length) {
    output.push('### Removals', '');
    for (const removal of changes.removed) {
      output.push(featureBullet(removal));
    }
    output.push('');
  }

  if (changes.added.length) {
    output.push('### Additions', '');
    for (const addition of changes.added) {
      output.push(featureBullet(addition));
    }
    output.push('');
  }

  return output.join('\n');
};

/**
 * Get all the pulls that have been merged on GitHub
 * @param fromDate The start date to get merged pulls from
 * @returns The pull requests that have been merged
 */
const pullsFromGitHub = (fromDate: string): FeatureChange[] =>
  queryPRs({
    search: `is:pr merged:>=${fromDate}`,
    json: 'number,url,mergeCommit',
    jq: '[.[] | { mergeCommit: .mergeCommit.oid, number: .number, url: .url }]', // Flatten the structure provided by GitHub
  });

/**
 * Get the diff from the pull request
 * @param pull The pull request to test
 * @param task The Listr task this is run in
 * @returns The changes from the pull request
 */
const getDiff = (
  pull: FeatureChange,
  task: ListrTask,
): { added: string[]; removed: string[] } => {
  let diff;

  try {
    diff = diffFeatures({ ref1: pull.mergeCommit, quiet: true });
  } catch (e) {
    throw new Error(
      chalk`{red ${e}}\n {yellow (Failed to diff features for #${pull.number}, skipping)}`,
    );
  }

  if (diff.added.length && diff.removed.length) {
    task.title += chalk` - {blue ({green ${diff.added.length} added}, {red ${diff.removed.length} removed})}`;
  } else if (diff.added.length) {
    task.title += chalk` - {blue ({green ${diff.added.length} added})}`;
  } else if (diff.removed.length) {
    task.title += chalk` - {blue ({red ${diff.removed.length} removed})}`;
  } else {
    task.title += chalk` - {blue (No feature count changes)}`;
  }

  return diff;
};

/**
 * Get changes from the pull requests that have been merged since a specified date
 * @param date The starting date to query pull requests from
 * @returns The changes from all of the pull requests
 */
export const getChanges = async (date: string): Promise<Changes> => {
  const pulls = pullsFromGitHub(date);

  const changes: Changes = {
    added: [],
    removed: [],
  };

  const tasks: ListrTask[] = pulls.map((pull) => ({
    title: `#${pull.number}`,
    /**
     * Get the diff from the pull request
     * @param task The Listr task this is run in
     */
    task: (task: ListrTask) => {
      const diff = getDiff(pull, task);

      changes.added.push(
        ...diff.added.map((feature) => ({
          number: pull.number,
          url: pull.url,
          feature,
        })),
      );

      changes.removed.push(
        ...diff.removed.map((feature) => ({
          number: pull.number,
          url: pull.url,
          feature,
        })),
      );
    },
  }));

  // XXX remove verbose renderer when https://github.com/SamVerschueren/listr/issues/150 fixed
  const runner = new Listr(tasks, {
    exitOnError: false,
    renderer: 'verbose',
    concurrent: 5,
    rendererOptions: {
      collapseSkips: false,
      collapseErrors: false,
    } as any,
  });

  runner.run();

  changes.added.sort((a, b) => a.feature.localeCompare(b.feature));
  changes.removed.sort((a, b) => a.feature.localeCompare(b.feature));

  return changes;
};
