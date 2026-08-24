/** The dev identities from the spec, and the grants their groups imply. */

export type SeedActor = {
  id: string;
  externalSubject: string;
  email: string;
  groups: string[];
};

export const SEED_ACTORS: SeedActor[] = [
  {
    id: "00000000-0000-4000-8000-00000000a11c",
    externalSubject: "alice",
    email: "alice@example.com",
    groups: ["reviewer"],
  },
  {
    id: "00000000-0000-4000-8000-00000000b0b0",
    externalSubject: "bob",
    email: "bob@example.com",
    groups: ["reviewer"],
  },
  {
    id: "00000000-0000-4000-8000-00000000ca01",
    externalSubject: "carol",
    email: "carol@example.com",
    groups: ["agent"],
  },
];

const RESOURCE_TYPES = ["kyc_case", "refund_request"];

export const SEED_GRANTS: { role: string; resourceType: string; action: string }[] =
  RESOURCE_TYPES.flatMap((resourceType) => [
    { role: "reviewer", resourceType, action: "read" },
    { role: "reviewer", resourceType, action: "write" },
    { role: "reviewer", resourceType, action: "approve" },
    { role: "agent", resourceType, action: "read" },
    { role: "agent", resourceType, action: "write" },
  ]);
