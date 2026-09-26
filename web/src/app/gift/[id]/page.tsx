import { ClaimView } from "@/components/ClaimView";
import { networkFromParam } from "@/lib/networks";

export default async function GiftPage({ params, searchParams }: PageProps<"/gift/[id]">) {
  const { id } = await params;
  // Missing or unknown ?network= falls back to Testnet — never guessed as Mainnet.
  const network = networkFromParam((await searchParams).network);
  return <ClaimView key={network} rawId={id} networkId={network} />;
}
