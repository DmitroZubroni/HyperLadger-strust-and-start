import { useContext, useState } from "react";
import { Button, Form, FormControl } from "react-bootstrap";
import { AtlantContext } from "../../../core/context.jsx";

const RegisterVehicle = () => {
    const { post } = useContext(AtlantContext);

    const [category, setCategory] = useState("A");
    const [marketValue, setMarketValue] = useState("");
    const [serviceLife, setServiceLife] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        await post("RegisterVehicle", [category, marketValue, serviceLife]);
    };

    return (
        <Form onSubmit={handleSubmit}>
            <h2>RegisterVehicle</h2>
            <Form.Select onChange={(e) => setCategory(e.target.value)}>
                <option>A</option>
                <option>B</option>
                <option>C</option>
            </Form.Select>
            <hr/>
            <FormControl type="number" placeholder="Рыночная стоимость, ProfiCoin" required onChange={(e) => setMarketValue(e.target.value)} />
            <hr/>
            <FormControl type="number" placeholder="Срок эксплуатации, лет" required onChange={(e) => setServiceLife(e.target.value)} />
            <hr/>
            <Button type="submit">Отправить</Button>
        </Form>
    );
};

export default RegisterVehicle;
