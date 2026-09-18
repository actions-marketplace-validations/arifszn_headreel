import type { GraphQLClient } from './graphql.js';

const QUERY = /* GraphQL */ `
  query Profile($login: String!) {
    user(login: $login) {
      login
      name
    }
  }
`;

interface ProfileResponse {
  user: { login: string; name: string | null };
}

export interface Profile {
  login: string;
  /** Profile name, falling back to login when unset. */
  name: string;
}

export async function fetchProfile(client: GraphQLClient, login: string): Promise<Profile> {
  const { user } = await client<ProfileResponse>(QUERY, { login });
  const name = user.name?.trim();
  return { login: user.login, name: name ? name : user.login };
}
