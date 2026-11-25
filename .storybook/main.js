/** @type {import('@storybook/html-vite').StorybookConfig} */
export default {
    framework: '@storybook/html-vite',
    stories: ['./generated/*.stories.js'],
    core: { disableTelemetry: true }
};
