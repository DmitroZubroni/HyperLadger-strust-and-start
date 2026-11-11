import {createContext, useState} from "react";
const AtlantContext = createContext({})

// Адрес API: тот же компьютер, с которого открыт сайт
const API = "http://" + window.location.hostname + ":8091"

// Запрос к API от имени пользователя name
const request = async (name, method, path, body) => {
    let res;
    try {
        res = await fetch(API + path, {
            method: method,
            headers: { "Content-Type": "application/json", Authorization: name },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (e) {
        // fetch не принимает кириллицу в заголовке: имя пользователя в сети пишется латиницей
        if (e.message.includes("ISO-8859-1")) {
            throw new Error("Имя пользователя пишется латиницей, например ivanov@users.example.com");
        }
        throw new Error("Нет связи с API");
    }
    const result = await res.json();
    if (!res.ok) {
        throw new Error(result.error);
    }
    return result;
}

const AppProvider = ({ children }) => {

    // Полное имя пользователя, например ivanov@users.example.com или Admin@bank.example.com
    const [user, setUser] = useState("")
    // Роли из контракта (WhoAmI): банк, сотрудник ДПС, зарегистрированный водитель
    const [roles, setRoles] = useState({ isBank: false, isDps: false, isDriver: false })
    const [isAuthorized, setIsAuthorized] = useState(false)

    // Вход: контракт проверяет пользователя и сообщает его роли
    const login = async (name) => {
        const clean = name.trim();
        if (!clean) {
            alert("введите имя пользователя");
            return;
        }
        try {
            const who = await request(clean, "GET", "/contract/WhoAmI");
            if (!who.isBank && !who.isDps && !who.isDriver) {
                alert("пользователь есть в сети, но не зарегистрирован как водитель: зарегистрируйтесь ниже");
                return;
            }
            setRoles(who);
            setUser(clean);
            setIsAuthorized(true);
            alert("вы авторизовались");
        } catch (e) {
            alert(e.message);
        }
    };

    // Регистрация водителя: пользователя заранее создают в терминале, здесь он вносит свои данные
    const register = async (name, fullName, experienceStartYear) => {
        const clean = name.trim();
        try {
            const result = await request(clean, "POST", "/contract/RegisterDriver", { args: [fullName, experienceStartYear] });
            alert(result.message);
            await login(clean);
        } catch (e) {
            alert(e.message);
        }
    };

    const logout = () => {
        setIsAuthorized(false)
        setUser("")
        setRoles({ isBank: false, isDps: false, isDriver: false })
    }

    // Чтение из контракта: GET /contract/<метод>?args=...
    const get = async (method, args = []) => {
        const query = new URLSearchParams(args.map((arg) => ["args", arg]));
        return request(user, "GET", `/contract/${method}?${query}`);
    };

    // Запись в контракт: POST /contract/<метод>, транзакция попадает в блок
    const post = async (method, args = []) => {
        try {
            const result = await request(user, "POST", `/contract/${method}`, { args: args });
            console.log(result);
            if (result.message) {
                alert(result.message);
            } else {
                alert("успешно");
            }
        } catch (e) {
            alert(e.message);
        }
    };


    const values = {
        user,
        isAuthorized,
        isBank: roles.isBank,
        isDps: roles.isDps,
        isDriver: roles.isDriver,
        login,
        register,
        logout,
        get,
        post
    }

    return <AtlantContext.Provider value={values}>{children}</AtlantContext.Provider>
}
export {AppProvider, AtlantContext}
