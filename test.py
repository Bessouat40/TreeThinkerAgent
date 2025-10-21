from app.backend.core.models.tool_calls import ToolCall
from app.backend.core.reasoningTree.reasoning_tree import ReasoningTree

tree = ReasoningTree("Je veux organiser un voyage à Madrid.")

#Leaf 1
tree.add_leaf(
    description="Définir le budget pour le voyage.",
    parent_leaf="leaf_0",
    tool_calls=[
        ToolCall(tool_name="CurrencyConverter", args={"from": "EUR", "to": "USD"}, result="$1000")
    ]
)

#Leaf 2
tree.add_leaf(
    description="Rechercher les vols disponibles depuis Paris vers Madrid.",
    parent_leaf="leaf_0",
    tool_calls=[
        ToolCall(tool_name="FlightSearch", args={"origin": "Paris", "destination": "Madrid"}, result="Vols à partir de 90€")
    ]
)

#Leaf 3
tree.add_leaf(
    description="Trouver un hôtel abordable à Madrid.",
    parent_leaf="leaf_0",
    tool_calls=[
        ToolCall(tool_name="HotelSearch", args={"city": "Madrid", "budget": "<100€/nuit"}, result="Hôtel Ibis, 89€/nuit")
    ]
)

#Leaf 4
tree.add_leaf(
    description="Réserver le vol choisi.",
    parent_leaf="leaf_2",
    tool_calls=[
        ToolCall(tool_name="FlightBooking", args={"flight_id": "AF1234"}, result="Réservation confirmée")
    ]
)

#Leaf 5
tree.add_leaf(
    description="Réserver l'hôtel sélectionné.",
    parent_leaf="leaf_3",
    tool_calls=[
        ToolCall(tool_name="HotelBooking", args={"hotel_name": "Ibis"}, result="Réservation confirmée")
    ]
)

print(tree.get_reasoning_tree_context())
