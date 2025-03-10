const { logger, handleError } = require("../utils/helpers");
const config = require("../../config");
const twitterService = require("./twitter");
const TwitterService = new twitterService();
const GithubService = require("./github");
const cron = require("node-cron");

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runDataPipeline = async (folder) => {
  for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
    try {
      const result = await TwitterService.fetchTweets({ folder });

      if (!result || !Array.isArray(result)) {
        throw new Error(
          `No valid tweets returned from Twitter service for folder: ${folder.name}`
        );
      }

      if (result.length > 0) {
        const githubResult = await GithubService.createMarkdownFileFromTweets(
          result,
          folder.name,
          folder
        );
        if (!githubResult?.success) {
          throw new Error("Failed to create and upload markdown file");
        }

        const tweetText = `New ${getTopicName(
          folder.name
        )} resource added!\n\nMade by @DRIX_10_ via @CosLynxAI\n\nCheck out the latest resource here:\n${
          githubResult.url
        }`;
        await TwitterService.postTweet(tweetText);

        return {
          queryName: folder.name,
          githubUrl: githubResult.url,
        };
      }
      return null;
    } catch (error) {
      console.log(error);
      if (retryCount === MAX_RETRIES) {
        handleError(
          error,
          `Pipeline error for folder type (attempt ${
            retryCount + 1
          }/${MAX_RETRIES})`,
          { folder }
        );
        throw error;
      }
      logger.info(`Retrying in ${RETRY_DELAY * (retryCount + 1)}ms...`);
      await sleep(RETRY_DELAY * (retryCount + 1));
    }
  }
};

function getTopicName(queryName) {
  const folder = config.folders.find((f) => f.name === queryName);
  return folder ? folder.name : "AI Scrapped";
}

let scheduledJob = null;

const scheduleRandomJob = () => {
  const RandNum = Math.floor(Math.random() * 16) + 1;
  const schedule = `0 */${RandNum} * * *`;

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron schedule: ${schedule}`);
  }

  logger.info(`Scheduling job to run every ${RandNum} hours`);

  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
  }

  scheduledJob = cron.schedule(
    schedule,
    async () => {
      const timestamp = new Date().toISOString();
      logger.info(`Running scheduled pipeline at ${timestamp}`);

      try {
        await TwitterService.init();

        for (const folder of config.folders) {
          const result = await runDataPipeline(folder);
          if (result) {
            logger.info(
              `Pipeline succeeded for folder type ${result.queryName}: ${result.githubUrl}`
            );
          } else {
            logger.info(
              `Pipeline completed for folder, but no new threads were found.`
            );
          }
        }
        await GithubService.updateReadmeWithNewFile(
          config.github.owner,
          config.github.repo
        );
      } catch (error) {
        logger.error("Scheduled pipeline failed:", error);
      }

      scheduleRandomJob();
    },
    {
      scheduled: true,
      timezone: "UTC",
      runOnInit: false,
    }
  );

  logger.info(`Cron job initialized with schedule: ${schedule}`);
};

const initCronJob = () => {
  try {
    if (scheduledJob) {
      logger.warn("Cron job already initialized");
      return scheduledJob;
    }

    runInitialPipeline();
    scheduleRandomJob();

    return scheduledJob;
  } catch (error) {
    logger.error("Failed to initialize cron job:", error);
    throw error;
  }
};

const stopCronJob = () => {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
    logger.info("Cron job stopped");
  } else {
    logger.warn("No active cron job to stop");
  }
};

const runInitialPipeline = async () => {
  logger.info("Running initial pipeline execution...");
  try {
    await TwitterService.init();

    for (const folder of config.folders) {
      const result = await runDataPipeline(folder);
      if (result) {
        logger.info(
          `Pipeline succeeded for folder type ${result.queryName}: ${result.githubUrl}`
        );
      } else {
        logger.info(
          `Pipeline completed for folder, but no new threads were found.`
        );
      }
    }
    await GithubService.updateReadmeWithNewFile(
      config.github.owner,
      config.github.repo
    );
  } catch (error) {
    logger.error("Initial pipeline execution failed:", error);
  }
};
module.exports = {
  runDataPipeline,
  initCronJob,
  stopCronJob,
};
