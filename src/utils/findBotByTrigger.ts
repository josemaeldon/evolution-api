import { advancedOperatorsSearch } from './advancedOperatorsSearch';

export const findBotByTrigger = async (botRepository: any, content: string, instanceId: string) => {
  if (!content?.trim()) {
    // An explicit "all" trigger may start a bot even for messages without text.
    return botRepository.findFirst({
      where: {
        enabled: true,
        triggerType: 'all',
        instanceId: instanceId,
      },
    });
  }

  const findTriggerAdvanced = await botRepository.findMany({
    where: {
      enabled: true,
      triggerType: 'advanced',
      instanceId: instanceId,
    },
  });
  for (const advanced of findTriggerAdvanced) {
    if (advancedOperatorsSearch(content, advanced.triggerValue)) {
      return advanced;
    }
  }

  // Check for exact match
  const findEquals = await botRepository.findMany({
    where: {
      enabled: true,
      triggerType: 'keyword',
      triggerOperator: 'equals',
      instanceId: instanceId,
    },
  });
  const normalizedContent = content?.trim().toLowerCase();
  const findTriggerEquals = findEquals.find(
    (bot: { triggerValue: string }) =>
      bot.triggerValue?.trim().toLowerCase() === normalizedContent && !!normalizedContent,
  );

  if (findTriggerEquals) {
    return findTriggerEquals;
  }

  // Broad "all" triggers must not shadow a matching exact keyword trigger.
  const findTriggerAll = await botRepository.findFirst({
    where: {
      enabled: true,
      triggerType: 'all',
      instanceId: instanceId,
    },
  });

  if (findTriggerAll) {
    return findTriggerAll;
  }

  // Check for regex match
  const findRegex = await botRepository.findMany({
    where: {
      enabled: true,
      triggerType: 'keyword',
      triggerOperator: 'regex',
      instanceId: instanceId,
    },
  });

  let findTriggerRegex = null;

  for (const regex of findRegex) {
    if (regex.triggerValue) {
      try {
        if (new RegExp(regex.triggerValue).test(content)) {
          findTriggerRegex = regex;
          break;
        }
      } catch {
        // Ignore invalid expressions stored before validation was added.
      }
    }
  }

  if (findTriggerRegex) return findTriggerRegex;

  // Check for startsWith match
  const findStartsWith = await botRepository.findMany({
    where: {
      enabled: true,
      triggerType: 'keyword',
      triggerOperator: 'startsWith',
      instanceId: instanceId,
    },
  });

  let findTriggerStartsWith = null;

  for (const startsWith of findStartsWith) {
    if (startsWith.triggerValue && content.startsWith(startsWith.triggerValue)) {
      findTriggerStartsWith = startsWith;
      break;
    }
  }

  if (findTriggerStartsWith) return findTriggerStartsWith;

  // Check for endsWith match
  const findEndsWith = await botRepository.findMany({
    where: {
      enabled: true,
      triggerType: 'keyword',
      triggerOperator: 'endsWith',
      instanceId: instanceId,
    },
  });

  let findTriggerEndsWith = null;

  for (const endsWith of findEndsWith) {
    if (endsWith.triggerValue && content.endsWith(endsWith.triggerValue)) {
      findTriggerEndsWith = endsWith;
      break;
    }
  }

  if (findTriggerEndsWith) return findTriggerEndsWith;

  // Check for contains match
  const findContains = await botRepository.findMany({
    where: {
      enabled: true,
      triggerType: 'keyword',
      triggerOperator: 'contains',
      instanceId: instanceId,
    },
  });

  let findTriggerContains = null;

  for (const contains of findContains) {
    if (contains.triggerValue && content.includes(contains.triggerValue)) {
      findTriggerContains = contains;
      break;
    }
  }

  if (findTriggerContains) return findTriggerContains;

  return null;
};
