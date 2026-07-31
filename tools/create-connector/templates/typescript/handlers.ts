/**
 * Your logic goes here.
 *
 * Nothing in this file imports the Nimbus SDK or the MCP SDK, and that is deliberate: business
 * logic you can test without a wire protocol is business logic you will actually test. `main.ts`
 * is the only file that knows a protocol exists.
 */

export interface EchoInput {
  readonly text: string;
}

export async function echo(input: EchoInput): Promise<{ readonly text: string }> {
  return { text: input.text };
}
