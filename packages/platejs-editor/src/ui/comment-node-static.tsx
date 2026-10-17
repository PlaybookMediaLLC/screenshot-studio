import type { SlateLeafProps, TCommentText } from "../exports/platejs-static";
import { SlateLeaf } from "../exports/platejs-static";

export function CommentLeafStatic(props: SlateLeafProps<TCommentText>) {
  return (
    <SlateLeaf
      {...props}
      className="border-b-2 border-b-highlight/35 bg-highlight/15"
    />
  );
}
