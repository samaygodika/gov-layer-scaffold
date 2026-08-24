/**
 * Dev-mode actor switcher (prototype only). It writes the `dev_actor` cookie the
 * scaffold's development identity hook reads; in production that hook is not
 * registered and this control has no effect at all.
 */
import { writeDevActor, type Me } from "./api";

const DEV_ACTORS = ["alice", "bob", "carol"];

export function ActorSwitcher({ me, onChange }: { me: Me | null; onChange: () => void }) {
  return (
    <label>
      acting as{" "}
      <select
        value={me?.actor.externalSubject ?? ""}
        onChange={(event) => {
          writeDevActor(event.target.value);
          onChange();
        }}
      >
        <option value="" disabled>
          pick an actor
        </option>
        {DEV_ACTORS.map((subject) => (
          <option key={subject} value={subject}>
            {subject}
          </option>
        ))}
      </select>{" "}
      {me ? (
        <span>
          groups [{me.actor.groups.join(", ")}] — may{" "}
          {(["read", "write", "approve"] as const).filter((action) => me.can[action]).join(", ") ||
            "nothing"}
        </span>
      ) : (
        <span>no identity</span>
      )}
    </label>
  );
}
